package edu.srm.hallbooking.register;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import edu.srm.hallbooking.domain.RegisterSlot;
import edu.srm.hallbooking.domain.SlotStatus;
import edu.srm.hallbooking.repository.NotificationRepository;
import edu.srm.hallbooking.repository.RegisterSlotRepository;
import java.time.LocalDate;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

/** The register keeps the json-server contract the BPMN's REST connectors and FEEL rely on. */
@WebMvcTest(RegisterController.class)
@Import(RegisterMode.class)
class RegisterControllerTest {

  @Autowired MockMvc mvc;
  @Autowired RegisterMode mode;
  @MockitoBean RegisterSlotRepository slots;
  @MockitoBean NotificationRepository notifications;

  @AfterEach
  void up() {
    mode.set(RegisterMode.Mode.UP);
  }

  @Test
  void checkSessionGetsTheBookingsOfOneVenueAndDayWithTheFieldNamesFeelUses() throws Exception {
    when(slots.findByHallAndDayOrderByStartHourAsc("hall-a", LocalDate.of(2027, 1, 11))).thenReturn(List.of(
        new RegisterSlot("hall-a", LocalDate.of(2027, 1, 11), 10, 12, SlotStatus.CONFIRMED, "Dr. Rao")));

    mvc.perform(get("/register/bookings").param("hall", "hall-a").param("day", "2027-01-11"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$[0].hall").value("hall-a"))
        .andExpect(jsonPath("$[0].day").value("2027-01-11"))
        .andExpect(jsonPath("$[0].startHour").value(10))
        .andExpect(jsonPath("$[0].endHour").value(12))
        .andExpect(jsonPath("$[0].status").value("CONFIRMED"));
  }

  @Test
  void holdSlotCreatesAPendingBooking() throws Exception {
    when(slots.save(any(RegisterSlot.class))).thenAnswer(inv -> inv.getArgument(0));

    mvc.perform(post("/register/bookings").contentType(MediaType.APPLICATION_JSON)
            .content("{\"hall\":\"lab-1\",\"day\":\"2027-01-26\",\"startHour\":14,\"endHour\":16,"
                + "\"status\":\"PENDING\",\"requester\":\"Dr. Test\"}"))
        .andExpect(status().isCreated())
        .andExpect(jsonPath("$.hall").value("lab-1"))
        .andExpect(jsonPath("$.status").value("PENDING"));
  }

  @Test
  void downModeAnswers503SoTheConnectorRaisesBookingServiceDown() throws Exception {
    mode.set(RegisterMode.Mode.DOWN);
    mvc.perform(get("/register/bookings")).andExpect(status().isServiceUnavailable());
  }
}
