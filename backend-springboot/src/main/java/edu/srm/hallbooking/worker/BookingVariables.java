package edu.srm.hallbooking.worker;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import java.util.List;

/**
 * Strongly typed process variables for the job workers (bound with {@code @VariablesAsType}; Camunda only sends the
 * variables named by the record components).
 */
public final class BookingVariables {

  private BookingVariables() {}

  /** slot = {startHour, endHour, durationHours}, added to each session by the Prepare sessions FEEL script. */
  @JsonIgnoreProperties(ignoreUnknown = true)
  public record Slot(Integer startHour, Integer endHour, Integer durationHours) {}

  /** One entry of the sessions list: venue, bookingDate (yyyy-MM-dd), startTime and endTime (HH:00), slot. */
  @JsonIgnoreProperties(ignoreUnknown = true)
  public record Session(String venue, String bookingDate, String startTime, String endTime, Slot slot) {}

  /** Input of validate-booking: the start payload after Prepare sessions. */
  @JsonIgnoreProperties(ignoreUnknown = true)
  public record ValidateInput(String requesterName, String email, Integer attendees, String purpose,
      List<Session> sessions) {}

  /** Input of send-reminder (inside hall-approval, so these are the Call Activity's mapped variables). */
  @JsonIgnoreProperties(ignoreUnknown = true)
  public record ReminderInput(String approverRole, String bookingRef, String requesterName, Integer attendees,
      List<Session> sessions) {}

  /** Input of record-notification: the task's input mappings plus the Email connector's result. */
  @JsonIgnoreProperties(ignoreUnknown = true)
  public record RecordInput(String to, String subject, String message, String bookingRef, String outcome,
      String emailStatus, String emailError, List<String> approvers) {}

  /** The validation variable: {valid, reason, message, session, sessions, checkedOn}. */
  public record Validation(boolean valid, String reason, String message, Integer session, int sessions,
      String checkedOn) {}

  /** Result of validate-booking when the request is valid. */
  public record ValidateOutput(Validation validation) {}

  public record ReminderOutput(String reminderSentAt) {}

  public record RecordOutput(Long notificationId, String notifiedAt) {}
}
