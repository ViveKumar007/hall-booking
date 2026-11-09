package edu.srm.hallbooking.repository;

import static org.assertj.core.api.Assertions.assertThat;

import edu.srm.hallbooking.domain.BookingRequest;
import edu.srm.hallbooking.domain.RegisterSlot;
import edu.srm.hallbooking.domain.RequestSession;
import edu.srm.hallbooking.domain.SlotStatus;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.data.domain.PageRequest;

/** JPA mappings and queries against an in-memory H2 database. */
@DataJpaTest
class RepositoryTest {

  @Autowired RegisterSlotRepository slots;
  @Autowired BookingRequestRepository requests;

  @Test
  void findsTheBookingsOfOneVenueAndDay() {
    slots.save(new RegisterSlot("hall-a", LocalDate.of(2027, 1, 11), 14, 16, SlotStatus.PENDING, "B"));
    slots.save(new RegisterSlot("hall-a", LocalDate.of(2027, 1, 11), 10, 12, SlotStatus.CONFIRMED, "A"));
    slots.save(new RegisterSlot("hall-b", LocalDate.of(2027, 1, 11), 10, 12, SlotStatus.CONFIRMED, "C"));

    List<RegisterSlot> found = slots.findByHallAndDayOrderByStartHourAsc("hall-a", LocalDate.of(2027, 1, 11));

    assertThat(found).extracting(RegisterSlot::getRequester).containsExactly("A", "B");
  }

  @Test
  void keepsTheSessionsOfARequestInOrder() {
    BookingRequest r = new BookingRequest(42L);
    r.setEmail("Rao@College.edu");
    r.setCreatedAt(Instant.parse("2026-11-09T06:00:00Z"));
    r.replaceSessions(List.of(new RequestSession("hall-a", "2027-01-26", "10:00", "12:00"),
        new RequestSession("lab-1", "2027-01-26", "14:00", "16:00")));
    requests.saveAndFlush(r);

    List<BookingRequest> mine = requests.findByEmailIgnoreCaseOrderByCreatedAtDesc("rao@college.edu", PageRequest.of(0, 10));

    assertThat(mine).hasSize(1);
    assertThat(mine.get(0).getSessions()).extracting(RequestSession::getVenue).containsExactly("hall-a", "lab-1");
  }
}
