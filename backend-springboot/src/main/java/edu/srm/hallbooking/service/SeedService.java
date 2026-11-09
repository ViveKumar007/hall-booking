package edu.srm.hallbooking.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import edu.srm.hallbooking.config.AppProperties;
import edu.srm.hallbooking.domain.Notification;
import edu.srm.hallbooking.domain.NotificationKind;
import edu.srm.hallbooking.domain.RegisterSlot;
import edu.srm.hallbooking.domain.SlotStatus;
import edu.srm.hallbooking.repository.NotificationRepository;
import edu.srm.hallbooking.repository.RegisterSlotRepository;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.time.LocalDate;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Fills the booking register. On the first start (empty register) it imports the old json-server data file if it
 * exists, otherwise the three seed bookings; {@link #reset()} restores the seed for a demo or a test run.
 */
@Service
public class SeedService implements ApplicationRunner {

  private static final Logger log = LoggerFactory.getLogger(SeedService.class);
  static final String SEED = "seed/register-seed.json";

  private final RegisterSlotRepository slots;
  private final NotificationRepository notifications;
  private final AppProperties props;
  private final ObjectMapper json;

  public SeedService(RegisterSlotRepository slots, NotificationRepository notifications, AppProperties props,
      ObjectMapper json) {
    this.slots = slots;
    this.notifications = notifications;
    this.props = props;
    this.json = json;
  }

  @Override
  @Transactional
  public void run(ApplicationArguments args) throws IOException {
    if (slots.count() > 0) {
      return;
    }
    Path legacy = props.importFile() == null ? null : Path.of(props.importFile());
    if (legacy != null && Files.isRegularFile(legacy)) {
      int[] counts = load(json.readTree(legacy.toFile()), true);
      log.info("Imported {} bookings and {} notifications from {}", counts[0], counts[1], legacy.toAbsolutePath());
    } else {
      int[] counts = loadSeed();
      log.info("Booking register seeded with {} bookings", counts[0]);
    }
  }

  /** Back to the three seed bookings, no notifications. */
  @Transactional
  public int reset() throws IOException {
    slots.deleteAllInBatch();
    notifications.deleteAllInBatch();
    return loadSeed()[0];
  }

  private int[] loadSeed() throws IOException {
    try (InputStream in = new ClassPathResource(SEED).getInputStream()) {
      return load(json.readTree(in), false);
    }
  }

  /** Reads {"bookings": [...], "notifications": [...]} in the json-server layout. */
  private int[] load(JsonNode root, boolean withNotifications) {
    int b = 0;
    int n = 0;
    for (JsonNode s : root.path("bookings")) {
      slots.save(new RegisterSlot(s.path("hall").asText(), LocalDate.parse(s.path("day").asText()),
          s.path("startHour").asInt(), s.path("endHour").asInt(),
          SlotStatus.valueOf(s.path("status").asText("CONFIRMED")), s.path("requester").asText(null)));
      b++;
    }
    if (withNotifications) {
      for (JsonNode x : root.path("notifications")) {
        notifications.save(new Notification(NotificationKind.OUTCOME, x.path("to").asText(null),
            x.path("subject").asText(null), x.path("message").asText(null), x.path("bookingRef").asText(null),
            null, x.path("emailStatus").asText(null), x.path("emailError").asText(null), instant(x.path("sentAt"))));
        n++;
      }
    }
    return new int[] {b, n};
  }

  private static Instant instant(JsonNode node) {
    try {
      return node.isTextual() ? Instant.parse(node.asText()) : null;
    } catch (RuntimeException e) {
      return null;
    }
  }
}
