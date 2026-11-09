package edu.srm.hallbooking.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import edu.srm.hallbooking.service.ValidationService.InvalidRequest;
import edu.srm.hallbooking.worker.BookingVariables.Session;
import edu.srm.hallbooking.worker.BookingVariables.Slot;
import edu.srm.hallbooking.worker.BookingVariables.ValidateInput;
import edu.srm.hallbooking.worker.BookingVariables.Validation;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneId;
import java.util.List;
import org.junit.jupiter.api.Test;

/** The validate-booking rules, on a fixed "today" of 9 Nov 2026. */
class ValidationServiceTest {

  private final ValidationService service =
      new ValidationService(Clock.fixed(Instant.parse("2026-11-09T06:00:00Z"), ZoneId.of("Asia/Kolkata")));

  private static Session session(String venue, String date, int from, int to) {
    return new Session(venue, date, String.format("%02d:00", from), String.format("%02d:00", to),
        new Slot(from, to, to - from));
  }

  private static ValidateInput request(int attendees, Session... sessions) {
    return new ValidateInput("Dr. Test", "test@college.edu", attendees, "Workshop", List.of(sessions));
  }

  private static InvalidRequest reject(ValidationService s, ValidateInput in) {
    try {
      s.validate(in);
    } catch (InvalidRequest e) {
      return e;
    }
    throw new AssertionError("expected the request to be rejected");
  }

  @Test
  void validSingleSession() throws InvalidRequest {
    Validation v = service.validate(request(50, session("hall-a", "2027-01-12", 14, 16)));
    assertThat(v.valid()).isTrue();
    assertThat(v.sessions()).isEqualTo(1);
    assertThat(v.checkedOn()).isEqualTo("2026-11-09");
  }

  @Test
  void endBeforeStartIsInvalidTime() {
    InvalidRequest e = reject(service, request(20, session("hall-b", "2027-01-14", 15, 13)));
    assertThat(e.reason()).isEqualTo("INVALID_TIME");
    assertThat(e.getMessage()).isEqualTo("The end time must be after the start time.");
  }

  @Test
  void zeroLengthIsInvalidTime() {
    assertThat(reject(service, request(20, session("hall-a", "2027-01-20", 10, 10))).reason()).isEqualTo("INVALID_TIME");
  }

  @Test
  void pastDate() {
    InvalidRequest e = reject(service, request(30, session("hall-a", "2026-10-01", 10, 12)));
    assertThat(e.reason()).isEqualTo("PAST_DATE");
    assertThat(e.getMessage()).contains("2026-10-01");
  }

  @Test
  void todayIsNotPast() throws InvalidRequest {
    assertThat(service.validate(request(30, session("hall-a", "2026-11-09", 10, 12))).valid()).isTrue();
  }

  @Test
  void overCapacityAndExactCapacity() throws InvalidRequest {
    InvalidRequest e = reject(service, request(61, session("lab-1", "2027-01-19", 10, 12)));
    assertThat(e.reason()).isEqualTo("OVER_CAPACITY");
    assertThat(e.getMessage()).isEqualTo("Computer Lab 1 holds at most 60 people; you asked for 61.");
    assertThat(service.validate(request(60, session("lab-1", "2027-01-19", 13, 15))).valid()).isTrue();
  }

  @Test
  void multiSessionMessagesNameTheSession() {
    InvalidRequest e = reject(service, request(40,
        session("hall-a", "2027-01-26", 10, 12), session("lab-1", "2027-01-26", 16, 14)));
    assertThat(e.getMessage()).startsWith("Session 2: the end time");
    assertThat(e.session()).isEqualTo(2);
  }

  @Test
  void sessionsOfOneRequestMustNotOverlap() {
    InvalidRequest e = reject(service, request(40,
        session("hall-a", "2027-01-29", 10, 12), session("hall-a", "2027-01-29", 11, 13)));
    assertThat(e.reason()).isEqualTo("INVALID_TIME");
    assertThat(e.getMessage()).startsWith("Sessions 1 and 2 overlap");
  }

  @Test
  void backToBackSessionsAreFine() throws InvalidRequest {
    assertThat(service.validate(request(40,
        session("hall-a", "2027-01-29", 10, 12), session("hall-a", "2027-01-29", 12, 14))).valid()).isTrue();
  }

  @Test
  void noSessions() {
    assertThatThrownBy(() -> service.validate(request(10))).isInstanceOf(InvalidRequest.class)
        .hasMessage("The request has no sessions.");
  }
}
