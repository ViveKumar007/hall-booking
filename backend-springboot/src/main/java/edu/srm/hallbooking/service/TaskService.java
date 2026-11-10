package edu.srm.hallbooking.service;

import static edu.srm.hallbooking.camunda.Vars.get;
import static edu.srm.hallbooking.camunda.Vars.maps;
import static edu.srm.hallbooking.camunda.Vars.refs;
import static edu.srm.hallbooking.camunda.Vars.str;

import edu.srm.hallbooking.camunda.CamundaGateway;
import edu.srm.hallbooking.catalog.Catalog;
import edu.srm.hallbooking.config.AppProperties;
import edu.srm.hallbooking.security.SignedInUser;
import edu.srm.hallbooking.web.ApiException;
import io.camunda.client.api.command.ClientHttpException;
import io.camunda.client.api.search.enums.UserTaskState;
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

  /**
   * Open tasks of one kind. Service issues are for admins. Reviews: an approver sees those for their own roles, an
   * admin sees every role's; role narrows the list to one role ("all" = no filter). canDecide says whether the
   * signed-in person holds the role the review is for (an admin who is not the dean cannot decide for the dean).
   */
  public List<Map<String, Object>> openTasks(Kind kind, String role, SignedInUser user) {
    if (kind == Kind.SERVICE && !user.isAdmin()) {
      throw new ApiException(HttpStatus.FORBIDDEN, "Only an admin can see service issues.");
    }
    String elementId = kind == Kind.SERVICE ? "User_FixService" : "User_Approval";
    return camunda.openTasks(elementId).stream()
        .map(t -> describe(kind, t))
        .filter(t -> kind == Kind.SERVICE || user.isAdmin() || user.holds(str(t, "approver")))
        .filter(t -> kind == Kind.SERVICE || role == null || role.isBlank() || "all".equals(role)
            || role.equals(t.get("approver")))
        .peek(t -> t.put("canDecide", kind == Kind.SERVICE ? user.isAdmin() : user.holds(str(t, "approver"))))
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
        ? t.getCreationDate().plus(ApprovalTimes.timeoutOf(v, props.approvalTimeout())).toString() : null);
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

  /**
   * Completes Review booking with {approved, remarks, decidedBy}. Only someone holding the review's approver role may
   * decide it; decidedBy (their email) goes into the recorded decision.
   */
  public void decide(long userTaskKey, Boolean approved, String remarks, SignedInUser user) {
    if (approved == null) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "Say whether the booking is approved.");
    }
    UserTask task = openTask(userTaskKey, "User_Approval");
    String approver = str(camunda.variables(task.getProcessInstanceKey()), "approver");
    if (!user.holds(approver)) {
      throw new ApiException(HttpStatus.FORBIDDEN,
          "This review is for the " + Catalog.roleName(approver) + "; your account does not hold that role.");
    }
    camunda.completeTask(userTaskKey, Map.of("approved", approved, "remarks", SafeText.plain(remarks),
        "decidedBy", user.email()));
  }

  /** Completes Resolve service issue with {serviceFixAction: RETRY | CANCEL}. Admins only. */
  public void serviceAction(long userTaskKey, String action, SignedInUser user) {
    if (!user.isAdmin()) {
      throw new ApiException(HttpStatus.FORBIDDEN, "Only an admin can resolve service issues.");
    }
    if (!"RETRY".equals(action) && !"CANCEL".equals(action)) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "Choose Retry or Cancel.");
    }
    openTask(userTaskKey, "User_FixService");
    camunda.completeTask(userTaskKey, Map.of("serviceFixAction", action, "resolvedBy", user.email()));
  }

  /** The open task of that element, or 404 (a task that is done, expired, or of another kind). */
  private UserTask openTask(long userTaskKey, String elementId) {
    UserTask task;
    try {
      task = camunda.task(userTaskKey);
    } catch (ClientHttpException e) {
      if (e.code() == 404) {
        throw new ApiException(HttpStatus.NOT_FOUND, "That task is already done or no longer exists.");
      }
      throw e;
    }
    if (!elementId.equals(task.getElementId()) || task.getState() != UserTaskState.CREATED) {
      throw new ApiException(HttpStatus.NOT_FOUND, "That task is already done or no longer exists.");
    }
    return task;
  }
}
