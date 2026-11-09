package edu.srm.hallbooking.service;

import edu.srm.hallbooking.catalog.Catalog;
import io.camunda.client.api.search.enums.ProcessInstanceState;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.Map;

/** The status chip of a booking: {code, label, tone}, from the instance state, its outcome, or where it waits. */
public record BookingStatus(String code, String label, String tone) {

  /** Active elements that mean "the request is waiting here", in the order they are checked. */
  private static final Map<String, BookingStatus> WAITING_AT = new LinkedHashMap<>();

  static {
    WAITING_AT.put("Worker_ValidateRequest", new BookingStatus("Worker_ValidateRequest", "Validating", "live"));
    WAITING_AT.put("SubProcess_CheckAvailability", new BookingStatus("SubProcess_CheckAvailability", "Checking availability", "live"));
    WAITING_AT.put("User_FixService", new BookingStatus("User_FixService", "Service issue", "bad"));
    WAITING_AT.put("CallActivity_Approval", new BookingStatus("CallActivity_Approval", "Awaiting approval", "live"));
    WAITING_AT.put("Email_NotifyRequester", new BookingStatus("Email_NotifyRequester", "Sending email", "live"));
    WAITING_AT.put("Worker_Notify", new BookingStatus("Worker_Notify", "Notifying", "live"));
  }

  public static final BookingStatus REGISTERING = new BookingStatus("REGISTERING", "Registering", "live");
  public static final BookingStatus UNAVAILABLE = new BookingStatus("UNAVAILABLE", "Status unavailable", "idle");

  public static BookingStatus ofOutcome(String outcome) {
    Catalog.Display d = outcome == null ? null : Catalog.OUTCOMES.get(outcome);
    return d == null ? new BookingStatus("DONE", "Finished", "idle") : new BookingStatus(outcome, d.label(), d.tone());
  }

  /** activeElementIds in the order the elements started (the first known waiting point wins). */
  public static BookingStatus of(ProcessInstanceState state, boolean hasIncident, String outcome,
      Collection<String> activeElementIds) {
    if (hasIncident) {
      return new BookingStatus("INCIDENT", "Needs attention", "bad");
    }
    if (state == ProcessInstanceState.COMPLETED) {
      return ofOutcome(outcome);
    }
    if (state == ProcessInstanceState.TERMINATED) {
      return new BookingStatus("CANCELED", "Cancelled", "idle");
    }
    for (String id : activeElementIds) {
      BookingStatus waiting = WAITING_AT.get(id);
      if (waiting != null) {
        return waiting;
      }
    }
    return new BookingStatus("RUNNING", "In progress", "live");
  }
}
