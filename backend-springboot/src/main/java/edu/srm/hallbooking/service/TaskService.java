package edu.srm.hallbooking.service;

import static edu.srm.hallbooking.camunda.Vars.get;
import static edu.srm.hallbooking.camunda.Vars.maps;
import static edu.srm.hallbooking.camunda.Vars.refs;
import static edu.srm.hallbooking.camunda.Vars.str;

import edu.srm.hallbooking.camunda.CamundaGateway;
import edu.srm.hallbooking.config.AppProperties;
import edu.srm.hallbooking.web.ApiException;
import io.camunda.client.api.search.response.UserTask;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

/**
 * The custom Tasklist: open Review booking tasks (in the hall-approval child processes) and Resolve service issue
 * tasks (in hall-booking), and completing them with the variables the BPMN expects.
 */
@Service
public class TaskService {

  public enum Kind { APPROVAL, SERVICE }

  private final CamundaGateway camunda;
  private final AppProperties props;

  public TaskService(CamundaGateway camunda, AppProperties props) {
    this.camunda = camunda;
    this.props = props;
  }

  /** Open tasks of one kind; for approvals optionally only those for one approver role ("all" = every role). */
  public List<Map<String, Object>> openTasks(Kind kind, String role) {
    String elementId = kind == Kind.SERVICE ? "User_FixService" : "User_Approval";
    return camunda.openTasks(elementId).stream()
        .map(t -> describe(kind, t))
        .filter(t -> kind == Kind.SERVICE || role == null || role.isBlank() || "all".equals(role)
            || role.equals(t.get("approver")))
        .sorted(Comparator.comparing(t -> String.valueOf(t.get("created"))))
        .toList();
  }

  private Map<String, Object> describe(Kind kind, UserTask t) {
    long pik = t.getProcessInstanceKey();
    Map<String, Object> v = camunda.variables(pik);
    List<Map<String, Object>> sessions = maps(v, "sessions");
    Map<String, Object> first = sessions.isEmpty() ? Map.of() : sessions.get(0);
    // A review lives in a Hall Approval child instance whose parent is the booking; a service issue is in the booking.
    String bookingKey = String.valueOf(pik);
    if (kind == Kind.APPROVAL) {
      Long parent = camunda.instance(pik).getParentProcessInstanceKey();
      bookingKey = parent == null ? null : String.valueOf(parent);
    }
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("key", String.valueOf(t.getUserTaskKey()));
    m.put("kind", kind.name().toLowerCase());
    m.put("processInstanceKey", String.valueOf(pik));
    m.put("created", t.getCreationDate() == null ? null : t.getCreationDate().toString());
    m.put("due", kind == Kind.APPROVAL && t.getCreationDate() != null
        ? t.getCreationDate().plusMinutes(props.approvalMinutes()).toString() : null);
    m.put("reminderSent", get(v, "reminderSentAt") != null);
    m.put("requesterName", str(v, "requesterName"));
    m.put("email", str(v, "email"));
    m.put("venue", first.get("venue"));
    m.put("bookingDate", first.get("bookingDate"));
    m.put("startTime", first.get("startTime"));
    m.put("endTime", first.get("endTime"));
    m.put("sessions", sessions);
    m.put("attendees", get(v, "attendees"));
    m.put("purpose", str(v, "purpose"));
    m.put("approver", str(v, "approver"));
    m.put("approvalStep", get(v, "approvalStep"));
    m.put("approvalSteps", get(v, "approvalSteps"));
    m.put("bookingRef", str(v, "bookingRef") != null ? str(v, "bookingRef") : refs(v));
    m.put("serviceError", str(v, "serviceError"));
    m.put("bookingKey", bookingKey);
    return m;
  }

  /** Completes Review booking with {approved, remarks}. */
  public void decide(long userTaskKey, Boolean approved, String remarks) {
    if (approved == null) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "Say whether the booking is approved.");
    }
    camunda.completeTask(userTaskKey, Map.of("approved", approved, "remarks", remarks == null ? "" : remarks.trim()));
  }

  /** Completes Resolve service issue with {serviceFixAction: RETRY | CANCEL}. */
  public void serviceAction(long userTaskKey, String action) {
    if (!"RETRY".equals(action) && !"CANCEL".equals(action)) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "Choose Retry or Cancel.");
    }
    camunda.completeTask(userTaskKey, Map.of("serviceFixAction", action));
  }
}
