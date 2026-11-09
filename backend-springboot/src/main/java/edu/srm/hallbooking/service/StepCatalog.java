package edu.srm.hallbooking.service;

import static edu.srm.hallbooking.camunda.Vars.count;
import static edu.srm.hallbooking.camunda.Vars.get;
import static edu.srm.hallbooking.camunda.Vars.isTrue;
import static edu.srm.hallbooking.camunda.Vars.maps;
import static edu.srm.hallbooking.camunda.Vars.refs;
import static edu.srm.hallbooking.camunda.Vars.str;
import static edu.srm.hallbooking.camunda.Vars.strings;

import edu.srm.hallbooking.catalog.Catalog;
import io.camunda.client.api.search.enums.ElementInstanceState;
import io.camunda.client.api.search.response.ElementInstance;
import java.util.HashMap;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * The steps of the live route ("routing slip") on the request page: which BPMN elements to show, in which lane
 * (desk = hall-booking, admin = the hall-approval child processes), and what to say about them.
 */
final class StepCatalog {

  private StepCatalog() {}

  /** v = booking variables, el = the element instance, a = that approval instance's variables (empty for desk). */
  record Ctx(Map<String, Object> v, ElementInstance el, Map<String, Object> a) {
    boolean active() { return el.getState() == ElementInstanceState.ACTIVE; }
    boolean terminated() { return el.getState() == ElementInstanceState.TERMINATED; }
  }

  /** message "out" / "in" marks a hand-over between the lanes, drawn as an arrow. */
  record Step(String lane, String message, String label, Function<Ctx, String> detail) {}

  static final Map<String, Step> STEPS = new HashMap<>();

  private static void desk(String id, String label, Function<Ctx, String> detail) {
    STEPS.put(id, new Step("desk", null, label, detail));
  }

  private static void admin(String id, String label, Function<Ctx, String> detail) {
    STEPS.put(id, new Step("admin", null, label, detail));
  }

  private static String sessionsSummary(Map<String, Object> v) {
    return maps(v, "sessions").stream().map(s -> s.get("startTime") + "–" + s.get("endTime"))
        .collect(Collectors.joining(", "));
  }

  private static String roles(Map<String, Object> v, String name, String separator) {
    return strings(v, name).stream().map(Catalog::roleName).collect(Collectors.joining(separator));
  }

  static {
    desk("StartEvent_Requested", "Request submitted", c -> str(c.v(), "requesterName") + " · " + str(c.v(), "attendees")
        + " people · " + count(maps(c.v(), "sessions").size(), "session"));
    desk("Script_PrepareSlot", "Sessions prepared", c -> sessionsSummary(c.v()));
    desk("Worker_ValidateRequest", "Checked by worker", c -> c.active() ? "Waiting for the worker"
        : (isTrue(c.v(), "validation", "valid") ? "Valid" : ""));
    desk("Boundary_Invalid", "Request invalid", c -> nz(str(c.v(), "validation", "message")));
    desk("Rest_CheckSession", "Sessions checked in parallel", c -> c.terminated() ? "Interrupted"
        : count(maps(c.v(), "sessions").size(), "register lookup"));
    desk("Script_DetectConflict", "Clash check", c -> {
      if (get(c.v(), "conflictCheck") == null) return "";
      if (!isTrue(c.v(), "conflictCheck", "hasConflict")) return "All sessions free";
      return "Clash: " + maps(c.v(), "conflictCheck", "clashes").stream()
          .map(x -> x.get("venue") + " " + x.get("bookingDate") + " " + x.get("startTime") + "–" + x.get("endTime"))
          .collect(Collectors.joining(", "));
    });
    desk("Boundary_ServiceDown", "Booking service unreachable", c -> nz(str(c.v(), "serviceError")));
    desk("Timer_CheckTimeout", "Availability check timed out", c -> "No answer within 30 seconds");
    desk("User_FixService", "Admin resolves service issue", c -> c.active() ? "Waiting for Retry or Cancel"
        : ("RETRY".equals(str(c.v(), "serviceFixAction")) ? "Retried" : "Cancelled"));
    desk("Script_SetReason", "Slot already taken", c -> "");
    desk("Script_SetServiceError", "Request cancelled", c -> "Booking service unavailable");
    desk("Dmn_DecideApprover", "Approver per session", c -> get(c.v(), "sessionApprovers") == null ? ""
        : roles(c.v(), "sessionApprovers", ", ") + " (decision table)");
    desk("Script_PlanApprovals", "Approval chain", c -> roles(c.v(), "approvers", " → "));
    desk("Rest_HoldSlot", "Slots held", c -> refs(c.v()) == null ? "" : refs(c.v()) + ", pending");
    STEPS.put("CallActivity_Approval", new Step("desk", "out", "Approval requested", c -> get(c.v(), "approvers") == null
        ? "" : count(strings(c.v(), "approvers").size(), "approver") + ", one after another"));
    STEPS.put("StartEvent_Approval", new Step("admin", "in", "Review opened", c -> {
      Integer steps = edu.srm.hallbooking.camunda.Vars.integer(c.a(), "approvalSteps");
      return "For " + Catalog.roleName(str(c.a(), "approver"))
          + (steps != null && steps > 1 ? " (step " + str(c.a(), "approvalStep") + " of " + steps + ")" : "");
    }));
    admin("User_Approval", "Review by approver", c -> {
      if (c.active()) return "Waiting for " + Catalog.roleName(str(c.a(), "approver"));
      if (c.terminated()) return "No response in time";
      String remarks = str(c.a(), "remarks");
      return (isTrue(c.a(), "approved") ? "Approved" : "Rejected")
          + (remarks == null || remarks.isBlank() ? "" : ": “" + remarks + "”");
    });
    admin("Worker_Reminder", "Reminder sent", c -> "To " + Catalog.roleName(str(c.a(), "approver")) + " after 1 minute");
    admin("Script_MarkExpired", "Marked as expired", c -> "Not reviewed within 2 minutes");
    STEPS.put("End_Decided", new Step("admin", "out", "Decision returned", c -> get(c.a(), "decision") == null ? ""
        : str(c.a(), "decision", "outcome") + " by " + Catalog.roleName(str(c.a(), "approver"))));
    STEPS.put("Script_SummarizeDecision", new Step("desk", "in", "Decisions combined",
        c -> nz(str(c.v(), "decision", "outcome"))));
    desk("Rest_ConfirmSlot", "Slots confirmed", c -> nz(refs(c.v())));
    desk("Rest_ReleaseRejected", "Slots released", c -> "Request was rejected");
    desk("Rest_ReleaseExpired", "Slots released", c -> "Request expired");
    desk("Email_NotifyRequester", "Email sent", c -> c.active() ? "Sending…"
        : (c.terminated() ? "Not delivered" : "To " + str(c.v(), "email") + " (Email connector, SMTP)"));
    desk("Boundary_EmailFailed", "Email failed", c -> {
      String error = str(c.v(), "emailError");
      return error == null ? "Mail server unreachable" : error;
    });
    desk("Worker_Notify", "Notification recorded", c -> "FAILED".equals(str(c.v(), "emailStatus"))
        ? "Kept for follow-up; the email did not go out" : "In the notifications log");
  }

  private static String nz(String s) {
    return s == null ? "" : s;
  }
}
