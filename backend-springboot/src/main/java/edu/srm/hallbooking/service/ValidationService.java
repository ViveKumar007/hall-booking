package edu.srm.hallbooking.service;

import edu.srm.hallbooking.catalog.Catalog;
import edu.srm.hallbooking.worker.BookingVariables.Session;
import edu.srm.hallbooking.worker.BookingVariables.Validation;
import edu.srm.hallbooking.worker.BookingVariables.ValidateInput;
import java.time.Clock;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.List;
import org.springframework.stereotype.Service;

/**
 * The business rules behind the validate-booking job, for every session of a request: the end time is after the
 * start time, the date is not in the past, the venue holds the attendees, and no two sessions of the same request
 * overlap each other. Plain logic, so it is unit tested without Camunda.
 */
@Service
public class ValidationService {

  /** A rule a request broke: reason is the outcome (INVALID_TIME, PAST_DATE, OVER_CAPACITY). */
  public static class InvalidRequest extends Exception {
    private final String reason;
    private final Integer session;

    InvalidRequest(String reason, String message, Integer session) {
      super(message);
      this.reason = reason;
      this.session = session;
    }

    public String reason() { return reason; }
    public Integer session() { return session; }
  }

  private final Clock clock;

  public ValidationService(Clock clock) {
    this.clock = clock;
  }

  public LocalDate today() {
    return LocalDate.now(clock);
  }

  /** Returns the validation for a valid request, or throws {@link InvalidRequest} at the first broken rule. */
  public Validation validate(ValidateInput in) throws InvalidRequest {
    List<Session> sessions = in.sessions() == null ? List.of() : in.sessions();
    boolean many = sessions.size() > 1;
    if (sessions.isEmpty()) {
      throw new InvalidRequest("INVALID_TIME", "The request has no sessions.", null);
    }
    LocalDate today = today();
    for (int i = 0; i < sessions.size(); i++) {
      Session s = sessions.get(i);
      if (s.slot() == null || s.slot().durationHours() == null || s.slot().durationHours() <= 0) {
        throw new InvalidRequest("INVALID_TIME", say(many, i, "the end time must be after the start time."), i + 1);
      }
      LocalDate date = parse(s.bookingDate());
      if (date == null || date.isBefore(today)) {
        throw new InvalidRequest("PAST_DATE", say(many, i, "the booking date " + s.bookingDate() + " has already passed."), i + 1);
      }
      var venue = Catalog.venue(s.venue());
      if (venue.isPresent() && in.attendees() != null && in.attendees() > venue.get().capacity()) {
        throw new InvalidRequest("OVER_CAPACITY", say(many, i, venue.get().name() + " holds at most " + venue.get().capacity()
            + " people; you asked for " + in.attendees() + "."), i + 1);
      }
    }
    for (int i = 0; i < sessions.size(); i++) {
      for (int j = i + 1; j < sessions.size(); j++) {
        Session a = sessions.get(i);
        Session b = sessions.get(j);
        boolean sameRoomAndDay = a.venue() != null && a.venue().equals(b.venue())
            && a.bookingDate() != null && a.bookingDate().equals(b.bookingDate());
        if (sameRoomAndDay && a.slot().startHour() < b.slot().endHour() && a.slot().endHour() > b.slot().startHour()) {
          throw new InvalidRequest("INVALID_TIME", "Sessions " + (i + 1) + " and " + (j + 1) + " overlap ("
              + describe(a) + " and " + describe(b) + ").", j + 1);
        }
      }
    }
    return new Validation(true, null, null, null, sessions.size(), today.toString());
  }

  /** The validation variable for a request that broke a rule. */
  public Validation invalid(InvalidRequest e) {
    return new Validation(false, e.reason(), e.getMessage(), e.session(), 0, today().toString());
  }

  public static String describe(Session s) {
    return s.venue() + " " + s.bookingDate() + " " + s.startTime() + "-" + s.endTime();
  }

  /** "Session 2: the end time ..." for multi-session requests, "The end time ..." for a single one. */
  private static String say(boolean many, int index, String text) {
    return many ? "Session " + (index + 1) + ": " + text : Character.toUpperCase(text.charAt(0)) + text.substring(1);
  }

  private static LocalDate parse(String date) {
    try {
      return date == null ? null : LocalDate.parse(date);
    } catch (DateTimeParseException e) {
      return null;
    }
  }
}
