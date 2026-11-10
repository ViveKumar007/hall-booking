package edu.srm.hallbooking.worker;

import edu.srm.hallbooking.domain.BookingRequest;
import edu.srm.hallbooking.domain.Notification;
import edu.srm.hallbooking.domain.NotificationKind;
import edu.srm.hallbooking.domain.RequestSession;
import edu.srm.hallbooking.repository.BookingRequestRepository;
import edu.srm.hallbooking.repository.NotificationRepository;
import edu.srm.hallbooking.service.ValidationService;
import edu.srm.hallbooking.service.ValidationService.InvalidRequest;
import edu.srm.hallbooking.worker.BookingVariables.RecordInput;
import edu.srm.hallbooking.worker.BookingVariables.RecordOutput;
import edu.srm.hallbooking.worker.BookingVariables.ReminderInput;
import edu.srm.hallbooking.worker.BookingVariables.ReminderOutput;
import edu.srm.hallbooking.worker.BookingVariables.Session;
import edu.srm.hallbooking.worker.BookingVariables.ValidateInput;
import edu.srm.hallbooking.worker.BookingVariables.ValidateOutput;
import edu.srm.hallbooking.worker.BookingVariables.Validation;
import io.camunda.client.annotation.JobWorker;
import io.camunda.client.annotation.VariablesAsType;
import io.camunda.client.api.response.ActivatedJob;
import io.camunda.zeebe.spring.common.exception.ZeebeBpmnError;
import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * The job workers for the BPMN's job types. Camunda creates a job when a token reaches one of these service tasks;
 * the SDK activates it, binds the variables to the typed record, calls the method, and completes the job with the
 * returned record as variables. A {@link ZeebeBpmnError} is reported as a BPMN error instead, so the process
 * continues at the matching error boundary event.
 */
@Component
public class BookingWorkers {

  private static final Logger log = LoggerFactory.getLogger(BookingWorkers.class);

  /** Error code caught by Boundary_Invalid on Validate request. */
  public static final String INVALID_REQUEST = "INVALID_REQUEST";

  private final ValidationService validation;
  private final BookingRequestRepository requests;
  private final NotificationRepository notifications;
  private final Clock clock;

  public BookingWorkers(ValidationService validation, BookingRequestRepository requests,
      NotificationRepository notifications, Clock clock) {
    this.validation = validation;
    this.requests = requests;
    this.notifications = notifications;
    this.clock = clock;
  }

  /**
   * validate-booking (Validate request). Records the request, then checks every session. A broken rule is a business
   * error: ZeebeBpmnError INVALID_REQUEST with the variables outcome and validation, caught by Boundary_Invalid.
   * ZeebeBpmnError is the 8.8 SDK's compatibility name for its BpmnError (CamundaError.bpmnError).
   */
  @SuppressWarnings("deprecation")
  @JobWorker(type = "validate-booking")
  public ValidateOutput validateBooking(@VariablesAsType ValidateInput in, ActivatedJob job) {
    BookingRequest request = requests.findById(job.getProcessInstanceKey())
        .orElseGet(() -> new BookingRequest(job.getProcessInstanceKey()));
    request.setRequesterName(in.requesterName());
    request.setEmail(in.email());
    request.setAttendees(in.attendees());
    request.setPurpose(in.purpose());
    request.replaceSessions(sessions(in.sessions()));
    if (request.getCreatedAt() == null) {
      request.setCreatedAt(Instant.now(clock));
    }
    String what = in.sessions() == null ? "no sessions"
        : in.sessions().stream().map(ValidationService::describe).collect(Collectors.joining(" + "));
    try {
      Validation valid = validation.validate(in);
      requests.save(request);
      log.info("validate-booking {} | {}, {} people -> VALID", in.requesterName(), what, in.attendees());
      return new ValidateOutput(valid);
    } catch (InvalidRequest e) {
      request.setOutcome(e.reason());
      requests.save(request);
      log.info("validate-booking {} | {} -> {}: {}", in.requesterName(), what, e.reason(), e.getMessage());
      throw new ZeebeBpmnError(INVALID_REQUEST, e.getMessage(),
          Map.of("outcome", e.reason(), "validation", validation.invalid(e)));
    }
  }

  /** send-reminder (Remind approver, after the non-interrupting 1-minute timer). */
  @JobWorker(type = "send-reminder")
  public ReminderOutput sendReminder(@VariablesAsType ReminderInput in, ActivatedJob job) {
    String sessions = in.sessions() == null ? "" : in.sessions().stream()
        .map(s -> "- " + ValidationService.describe(s)).collect(Collectors.joining("\n"));
    String message = in.requesterName() + " asked for these sessions, for " + in.attendees() + " people:\n" + sessions
        + "\nPlease approve or reject it in the Hall Booking inbox. It expires automatically if nobody decides in time.";
    notifications.save(new Notification(NotificationKind.REMINDER, in.approverRole(),
        "Reminder: booking " + in.bookingRef() + " is waiting for your review", message, in.bookingRef(),
        job.getProcessInstanceKey(), null, null, Instant.now(clock)));
    log.info("send-reminder reminded {} about {}", in.approverRole(), in.bookingRef());
    return new ReminderOutput(Instant.now(clock).toString());
  }

  /**
   * record-notification (Record notification, after the Email connector). Stores the requester's notice with the
   * email result, and finishes the request's database record.
   */
  @JobWorker(type = "record-notification")
  public RecordOutput recordNotification(@VariablesAsType RecordInput in, ActivatedJob job) {
    String emailStatus = in.emailStatus() == null ? "UNKNOWN" : in.emailStatus();
    Instant now = Instant.now(clock);
    Notification saved = notifications.save(new Notification(NotificationKind.OUTCOME, in.to(), in.subject(),
        in.message(), in.bookingRef(), job.getProcessInstanceKey(), emailStatus, in.emailError(), now));
    requests.findById(job.getProcessInstanceKey()).ifPresent(request -> {
      request.setOutcome(in.outcome());
      request.setApprovers(in.approvers() == null ? null : String.join(",", in.approvers()));
      request.setBookingRef(in.bookingRef());
      request.setEmailStatus(emailStatus);
      request.setFinishedAt(now);
      requests.save(request);
    });
    log.info("record-notification {} -> {} | email {}", in.subject(), in.to(), emailStatus);
    return new RecordOutput(saved.getId(), now.toString());
  }

  private static List<RequestSession> sessions(List<Session> sessions) {
    return sessions == null ? List.of() : sessions.stream()
        .map(s -> new RequestSession(s.venue(), s.bookingDate(), s.startTime(), s.endTime()))
        .toList();
  }
}
