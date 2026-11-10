package edu.srm.hallbooking.web;

import edu.srm.hallbooking.catalog.Catalog;
import edu.srm.hallbooking.config.AppProperties;
import edu.srm.hallbooking.domain.Notification;
import edu.srm.hallbooking.domain.RegisterSlot;
import edu.srm.hallbooking.repository.NotificationRepository;
import edu.srm.hallbooking.repository.RegisterSlotRepository;
import edu.srm.hallbooking.service.ApprovalTimes;
import edu.srm.hallbooking.service.HealthService;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** Reference data, status lights, the calendar and the notifications log. */
@RestController
@RequestMapping("/api")
public class InfoController {

  private final HealthService health;
  private final RegisterSlotRepository slots;
  private final NotificationRepository notifications;
  private final AppProperties props;

  public InfoController(HealthService health, RegisterSlotRepository slots, NotificationRepository notifications,
      AppProperties props) {
    this.health = health;
    this.slots = slots;
    this.notifications = notifications;
    this.props = props;
  }

  @GetMapping("/meta")
  public Map<String, Object> meta() {
    return Map.of("venues", Catalog.VENUES, "roles", Catalog.ROLES, "outcomes", Catalog.OUTCOMES,
        "approval", ApprovalTimes.variable(props.approvalTimeout(), props.approvalReminder()));
  }

  @GetMapping("/health")
  public Map<String, Object> health() {
    return health.health();
  }

  /** Booked slots (CONFIRMED and PENDING) between two dates, both optional. */
  @GetMapping("/calendar")
  public List<RegisterSlot> calendar(
      @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
      @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {
    if (from == null && to == null) {
      return slots.findAllByOrderByDayAscStartHourAsc();
    }
    return slots.findByDayBetweenOrderByDayAscStartHourAsc(
        from == null ? LocalDate.of(2000, 1, 1) : from, to == null ? LocalDate.of(2999, 12, 31) : to);
  }

  /** Newest first: requester notices (with the email result) and approver reminders. */
  @GetMapping("/notifications")
  public List<Notification> notifications() {
    return notifications.findAllByOrderByIdDesc();
  }
}
