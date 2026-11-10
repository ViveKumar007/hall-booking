package edu.srm.hallbooking.register;

import edu.srm.hallbooking.domain.Notification;
import edu.srm.hallbooking.domain.RegisterSlot;
import edu.srm.hallbooking.domain.SlotStatus;
import edu.srm.hallbooking.repository.NotificationRepository;
import edu.srm.hallbooking.repository.RegisterSlotRepository;
import edu.srm.hallbooking.service.SeedService;
import java.io.IOException;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * The booking register, called by the REST Outbound Connectors in hall-booking.bpmn through the connector secret
 * BOOKING_API_URL (= http://127.0.0.1:8090/register). Same contract as the json-server mock it replaces:
 *
 * <pre>
 * GET    /register/bookings?hall=&amp;day=   Check session (one call per session)
 * POST   /register/bookings               Hold slot (status PENDING)
 * PATCH  /register/bookings/{id}          Confirm slot (status CONFIRMED)
 * DELETE /register/bookings/{id}          Release slot (rejected / expired)
 * </pre>
 *
 * {@link RegisterOutageInterceptor} can make these calls fail or hang, to demonstrate the BPMN's error and timer
 * boundaries without stopping the backend.
 */
@RestController
@RequestMapping("/register")
public class RegisterController {

  private final RegisterSlotRepository slots;
  private final NotificationRepository notifications;
  private final SeedService seed;
  private final RegisterMode mode;

  public RegisterController(RegisterSlotRepository slots, NotificationRepository notifications, SeedService seed,
      RegisterMode mode) {
    this.slots = slots;
    this.notifications = notifications;
    this.seed = seed;
    this.mode = mode;
  }

  /**
   * Test helper for scripts/reset-data.cmd and run-scenarios.ps1: back to the three seed bookings, no notifications,
   * register switched back to normal. Like every /register call it needs the X-Register-Key.
   */
  @PostMapping("/reset")
  public Map<String, Object> reset() throws IOException {
    mode.set(RegisterMode.Mode.UP);
    return Map.of("ok", true, "bookings", seed.reset());
  }

  /** Body of POST /register/bookings, as the Hold slot connector sends it. */
  public record SlotInput(
      @NotBlank String hall,
      @NotNull LocalDate day,
      @Min(0) @Max(24) int startHour,
      @Min(0) @Max(24) int endHour,
      SlotStatus status,
      String requester) {}

  /** Body of PATCH /register/bookings/{id}: only the fields that are present change. */
  public record SlotPatch(SlotStatus status, String requester, Integer startHour, Integer endHour) {}

  @GetMapping("/bookings")
  public List<RegisterSlot> list(
      @RequestParam(required = false) String hall,
      @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate day) {
    if (hall != null && day != null) {
      return slots.findByHallAndDayOrderByStartHourAsc(hall, day);
    }
    if (hall != null) {
      return slots.findByHallOrderByDayAscStartHourAsc(hall);
    }
    if (day != null) {
      return slots.findByDayOrderByStartHourAsc(day);
    }
    return slots.findAllByOrderByDayAscStartHourAsc();
  }

  @GetMapping("/bookings/{id}")
  public ResponseEntity<RegisterSlot> get(@PathVariable long id) {
    return ResponseEntity.of(slots.findById(id));
  }

  @PostMapping("/bookings")
  @Transactional
  public ResponseEntity<RegisterSlot> create(@Valid @RequestBody SlotInput in) {
    RegisterSlot slot = new RegisterSlot(in.hall(), in.day(), in.startHour(), in.endHour(),
        in.status() == null ? SlotStatus.PENDING : in.status(), in.requester());
    return ResponseEntity.status(HttpStatus.CREATED).body(slots.save(slot));
  }

  @PatchMapping("/bookings/{id}")
  @Transactional
  public ResponseEntity<RegisterSlot> patch(@PathVariable long id, @RequestBody SlotPatch patch) {
    return slots.findById(id).map(slot -> {
      if (patch.status() != null) slot.setStatus(patch.status());
      if (patch.requester() != null) slot.setRequester(patch.requester());
      if (patch.startHour() != null) slot.setStartHour(patch.startHour());
      if (patch.endHour() != null) slot.setEndHour(patch.endHour());
      return ResponseEntity.ok(slots.save(slot));
    }).orElse(ResponseEntity.notFound().build());
  }

  @DeleteMapping("/bookings/{id}")
  @Transactional
  public ResponseEntity<Map<String, Object>> delete(@PathVariable long id) {
    if (!slots.existsById(id)) {
      return ResponseEntity.notFound().build();
    }
    slots.deleteById(id);
    return ResponseEntity.ok(Map.of());
  }

  @GetMapping("/notifications")
  public List<Notification> notifications() {
    return notifications.findAllByOrderByIdDesc();
  }

  @GetMapping("/notifications/{id}")
  public ResponseEntity<Notification> notification(@PathVariable long id) {
    return ResponseEntity.of(notifications.findById(id));
  }
}
