package edu.srm.hallbooking.service;

import static edu.srm.hallbooking.camunda.Vars.get;
import static edu.srm.hallbooking.camunda.Vars.maps;
import static edu.srm.hallbooking.camunda.Vars.refs;
import static edu.srm.hallbooking.camunda.Vars.str;
import static edu.srm.hallbooking.camunda.Vars.strings;

import edu.srm.hallbooking.camunda.CamundaGateway;
import edu.srm.hallbooking.camunda.Vars;
import edu.srm.hallbooking.catalog.Catalog;
import edu.srm.hallbooking.config.AppProperties;
import edu.srm.hallbooking.domain.BookingRequest;
import edu.srm.hallbooking.domain.RequestSession;
import edu.srm.hallbooking.repository.BookingRequestRepository;
import edu.srm.hallbooking.repository.NotificationRepository;
import edu.srm.hallbooking.web.ApiException;
import io.camunda.client.api.command.ClientException;
import io.camunda.client.api.command.ClientHttpException;
import io.camunda.client.api.search.enums.ElementInstanceState;
import io.camunda.client.api.search.enums.ProcessInstanceState;
import io.camunda.client.api.search.response.ElementInstance;
import io.camunda.client.api.search.response.ProcessInstance;
import java.time.Clock;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

/** Booking requests for the frontend: start one, list them, and follow one step by step. */
@Service
public class BookingService {

  private static final Pattern EMAIL = Pattern.compile("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$");
  private static final Pattern DATE = Pattern.compile("^\\d{4}-\\d{2}-\\d{2}$");
  private static final List<String> HOURS = java.util.stream.IntStream.rangeClosed(8, 18)
      .mapToObj(h -> String.format("%02d:00", h)).toList();

  /** A session as the frontend sends it. */
  public record SessionForm(String venue, String bookingDate, String startTime, String endTime) {}

  /**
   * POST /api/bookings body. Either a list of sessions, or one session as flat fields (venue, bookingDate,
   * startTime, endTime), which the current single-session form sends. attendees may arrive as a number or text.
   */
  public record BookingForm(String requesterName, String email, Object attendees, String purpose,
      String venue, String bookingDate, String startTime, String endTime, List<SessionForm> sessions) {}

  private final CamundaGateway camunda;
  private final BookingRequestRepository requests;
  private final NotificationRepository notifications;
  private final AppProperties props;
  private final Clock clock;

  public BookingService(CamundaGateway camunda, BookingRequestRepository requests,
      NotificationRepository notifications, AppProperties props, Clock clock) {
    this.camunda = camunda;
    this.requests = requests;
    this.notifications = notifications;
    this.props = props;
    this.clock = clock;
  }

  // ------------------------------------------------------------------ start

  /** Checks the form (missing or malformed fields only; business rules are the worker's), starts the process. */
  public long start(BookingForm form) {
    List<SessionForm> sessions = form.sessions() != null ? form.sessions()
        : List.of(new SessionForm(form.venue(), form.bookingDate(), form.startTime(), form.endTime()));
    Integer attendees = toInt(form.attendees());
    String name = form.requesterName() == null ? "" : form.requesterName().trim();
    String email = form.email() == null ? "" : form.email().trim();
    String purpose = form.purpose() == null ? "" : form.purpose().trim();

    Map<String, String> errors = new LinkedHashMap<>();
    if (name.isEmpty()) errors.put("requesterName", "Enter your name.");
    if (email.isEmpty()) errors.put("email", "Enter your email.");
    else if (!EMAIL.matcher(email).matches()) errors.put("email", "Enter an email like name@college.edu.");
    if (attendees == null || attendees < 1) errors.put("attendees", "Enter the number of people (at least 1).");
    if (sessions.isEmpty()) errors.put("sessions", "Add at least one session.");
    if (sessions.size() > 10) errors.put("sessions", "Ten sessions at most per request.");
    for (int i = 0; i < sessions.size(); i++) {
      SessionForm s = sessions.get(i);
      String prefix = i == 0 ? "" : "sessions." + i + ".";
      if (Catalog.venue(s.venue()).isEmpty()) errors.put(prefix + "venue", "Choose a venue.");
      if (s.bookingDate() == null || !DATE.matcher(s.bookingDate()).matches()) errors.put(prefix + "bookingDate", "Choose a date.");
      if (!HOURS.contains(s.startTime())) errors.put(prefix + "startTime", "Choose a start time.");
      if (!HOURS.contains(s.endTime())) errors.put(prefix + "endTime", "Choose an end time.");
    }
    if (!errors.isEmpty()) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "Some fields need attention.", "app", errors);
    }

    Map<String, Object> variables = new LinkedHashMap<>();
    variables.put("requesterName", name);
    variables.put("email", email);
    variables.put("attendees", attendees);
    variables.put("purpose", purpose);
    variables.put("sessions", sessions.stream().map(s -> Map.of(
        "venue", s.venue(), "bookingDate", s.bookingDate(), "startTime", s.startTime(), "endTime", s.endTime())).toList());
    long key = camunda.startBooking(variables);

    BookingRequest request = new BookingRequest(key);
    request.setRequesterName(name);
    request.setEmail(email);
    request.setAttendees(attendees);
    request.setPurpose(purpose);
    request.replaceSessions(sessions.stream()
        .map(s -> new RequestSession(s.venue(), s.bookingDate(), s.startTime(), s.endTime())).toList());
    request.setCreatedAt(Instant.now(clock));
    requests.save(request);
    return key;
  }

  // ------------------------------------------------------------------ list

  /**
   * Requests from the database, newest first. Finished ones carry their outcome; for the ones still running, the
   * current waiting point comes from Camunda (usually only a few, so this stays cheap).
   */
  public List<Map<String, Object>> list(String email, int limit) {
    PageRequest page = PageRequest.of(0, Math.max(1, Math.min(limit, 100)));
    List<BookingRequest> rows = email == null || email.isBlank()
        ? requests.findAllByOrderByCreatedAtDesc(page)
        : requests.findByEmailIgnoreCaseOrderByCreatedAtDesc(email.trim(), page);
    return rows.stream().map(this::row).toList();
  }

  private Map<String, Object> row(BookingRequest r) {
    String state = "COMPLETED";
    BookingStatus status;
    if (r.getOutcome() != null) {
      status = BookingStatus.ofOutcome(r.getOutcome());
    } else {
      try {
        ProcessInstance pi = camunda.instance(r.getProcessInstanceKey());
        state = pi.getState().name();
        List<String> active = pi.getState() == ProcessInstanceState.ACTIVE
            ? camunda.elements(r.getProcessInstanceKey(), ElementInstanceState.ACTIVE).stream()
                .map(ElementInstance::getElementId).toList()
            : List.of();
        String outcome = pi.getState() == ProcessInstanceState.COMPLETED
            ? str(camunda.variables(r.getProcessInstanceKey()), "outcome") : null;
        status = BookingStatus.of(pi.getState(), Boolean.TRUE.equals(pi.getHasIncident()), outcome, active);
      } catch (ClientHttpException e) {
        state = "ACTIVE";
        status = e.code() == 404 ? BookingStatus.REGISTERING // just started: not yet in Camunda's search index
            : BookingStatus.UNAVAILABLE;
      } catch (ClientException e) {
        state = "ACTIVE";
        status = BookingStatus.UNAVAILABLE; // Camunda not reachable: show the row anyway
      }
    }
    List<Map<String, Object>> sessions = r.getSessions().stream().map(BookingService::session).toList();
    List<String> approvers = r.getApprovers() == null || r.getApprovers().isBlank()
        ? List.of() : List.of(r.getApprovers().split(","));
    Map<String, Object> m = summaryBase(String.valueOf(r.getProcessInstanceKey()), state,
        iso(r.getCreatedAt()), iso(r.getFinishedAt()), r.getRequesterName(), r.getEmail(), sessions,
        r.getAttendees(), r.getPurpose(), approvers, r.getBookingRef(), r.getOutcome());
    m.put("status", status);
    return m;
  }

  // ------------------------------------------------------------------ detail

  /** One booking with its live route across the booking process and its approval child processes. */
  public Map<String, Object> detail(long key) {
    ProcessInstance pi = camunda.instance(key);
    if (pi.getProcessDefinitionId() != null && !CamundaGateway.BOOKING_PROCESS.equals(pi.getProcessDefinitionId())) {
      throw new ApiException(HttpStatus.NOT_FOUND, "That is not a booking.");
    }
    Map<String, Object> vars = camunda.variables(key);
    List<ElementInstance> deskEls = camunda.elements(key, null);
    List<String> activeIds = deskEls.stream().filter(e -> e.getState() == ElementInstanceState.ACTIVE)
        .map(ElementInstance::getElementId).toList();
    BookingStatus status = BookingStatus.of(pi.getState(), Boolean.TRUE.equals(pi.getHasIncident()),
        str(vars, "outcome"), activeIds);

    // One Hall Approval instance per approver asked; each element keeps the variables of its own instance.
    record Placed(ElementInstance el, Map<String, Object> approvalVars) {}
    List<Placed> placed = new ArrayList<>(deskEls.stream().map(e -> new Placed(e, Map.<String, Object>of())).toList());
    List<String> approvalKeys = new ArrayList<>();
    Map<String, Object> review = null;
    for (ProcessInstance child : camunda.children(key)) {
      long childKey = child.getProcessInstanceKey();
      approvalKeys.add(String.valueOf(childKey));
      Map<String, Object> a = camunda.variables(childKey);
      for (ElementInstance e : camunda.elements(childKey, null)) {
        placed.add(new Placed(e, a));
        if ("User_Approval".equals(e.getElementId()) && e.getState() == ElementInstanceState.ACTIVE) {
          review = new LinkedHashMap<>();
          review.put("since", iso(e.getStartDate()));
          review.put("due", iso(e.getStartDate().plusMinutes(props.approvalMinutes())));
          review.put("reminderSent", get(a, "reminderSentAt") != null);
          review.put("approver", str(a, "approver"));
          review.put("step", get(a, "approvalStep"));
          review.put("steps", get(a, "approvalSteps"));
        }
      }
    }

    // A step "happened" when it finished; running steps go last. A hand-over ("out") counts from its start, so it
    // sorts just before the step that receives it. Zeebe often finishes a whole chain in the same millisecond;
    // then the element instance key decides (keys grow in creation order on Camunda 8 Run's single partition).
    Comparator<Placed> order = Comparator
        .comparingLong((Placed p) -> happened(p.el()))
        .thenComparing(p -> p.el().getStartDate())
        .thenComparingLong(p -> p.el().getElementInstanceKey());
    List<Map<String, Object>> steps = placed.stream()
        .filter(p -> StepCatalog.STEPS.containsKey(p.el().getElementId()))
        .sorted(order)
        .map(p -> {
          StepCatalog.Step def = StepCatalog.STEPS.get(p.el().getElementId());
          StepCatalog.Ctx ctx = new StepCatalog.Ctx(vars, p.el(), p.approvalVars());
          Map<String, Object> s = new LinkedHashMap<>();
          s.put("id", p.el().getElementId());
          s.put("lane", def.lane());
          s.put("message", def.message());
          s.put("state", p.el().getState().name());
          s.put("at", iso("out".equals(def.message()) || p.el().getEndDate() == null
              ? p.el().getStartDate() : p.el().getEndDate()));
          s.put("label", def.label());
          s.put("detail", def.detail().apply(ctx));
          return s;
        })
        .toList();

    Object notification = null;
    Integer notificationId = Vars.integer(vars, "notificationId");
    if (notificationId != null) {
      notification = notifications.findById(notificationId.longValue()).orElse(null);
    }

    Map<String, Object> m = summaryBase(String.valueOf(key), pi.getState().name(), iso(pi.getStartDate()),
        iso(pi.getEndDate()), str(vars, "requesterName"), str(vars, "email"), sessions(vars), get(vars, "attendees"),
        str(vars, "purpose"), strings(vars, "approvers"), refs(vars), str(vars, "outcome"));
    m.put("status", status);
    m.put("approvalKeys", approvalKeys);
    m.put("review", review);
    m.put("remarks", str(vars, "decision", "remarks"));
    m.put("serviceError", str(vars, "serviceError"));
    m.put("validation", get(vars, "validation"));
    m.put("steps", steps);
    m.put("notification", notification);
    m.put("operateUrl", props.camundaWebUrl() + "/operate/processes/" + key);
    return m;
  }

  // ------------------------------------------------------------------ helpers

  /** Fields every booking summary has; venue/bookingDate/startTime/endTime describe the first session. */
  private static Map<String, Object> summaryBase(String key, String state, String startDate, String endDate,
      String requesterName, String email, List<Map<String, Object>> sessions, Object attendees, String purpose,
      List<String> approvers, String bookingRef, String outcome) {
    Map<String, Object> first = sessions.isEmpty() ? Map.of() : sessions.get(0);
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("key", key);
    m.put("state", state);
    m.put("startDate", startDate);
    m.put("endDate", endDate);
    m.put("requesterName", requesterName);
    m.put("email", email);
    m.put("venue", first.get("venue"));
    m.put("bookingDate", first.get("bookingDate"));
    m.put("startTime", first.get("startTime"));
    m.put("endTime", first.get("endTime"));
    m.put("sessions", sessions);
    m.put("attendees", attendees);
    m.put("purpose", purpose);
    m.put("approvers", approvers);
    m.put("approver", approvers.isEmpty() ? null : approvers.get(0));
    m.put("bookingRef", bookingRef);
    m.put("outcome", outcome);
    return m;
  }

  private static List<Map<String, Object>> sessions(Map<String, Object> vars) {
    return maps(vars, "sessions").stream().map(s -> {
      Map<String, Object> m = new LinkedHashMap<>();
      m.put("venue", s.get("venue"));
      m.put("bookingDate", s.get("bookingDate"));
      m.put("startTime", s.get("startTime"));
      m.put("endTime", s.get("endTime"));
      return m;
    }).toList();
  }

  private static Map<String, Object> session(RequestSession s) {
    Map<String, Object> m = new HashMap<>();
    m.put("venue", s.getVenue());
    m.put("bookingDate", s.getBookingDate());
    m.put("startTime", s.getStartTime());
    m.put("endTime", s.getEndTime());
    return m;
  }

  private static long happened(ElementInstance e) {
    StepCatalog.Step def = StepCatalog.STEPS.get(e.getElementId());
    if ("out".equals(def.message())) return e.getStartDate().toInstant().toEpochMilli();
    return e.getEndDate() == null ? Long.MAX_VALUE : e.getEndDate().toInstant().toEpochMilli();
  }

  private static String iso(OffsetDateTime t) {
    return t == null ? null : t.toString();
  }

  private static String iso(Instant t) {
    return t == null ? null : t.toString();
  }

  private static Integer toInt(Object value) {
    if (value instanceof Number n) {
      return n.doubleValue() == Math.rint(n.doubleValue()) ? n.intValue() : null;
    }
    if (value instanceof String s && !s.isBlank()) {
      try {
        return Integer.parseInt(s.trim());
      } catch (NumberFormatException e) {
        return null;
      }
    }
    return null;
  }
}
