package edu.srm.hallbooking;

import java.time.Clock;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;
import org.springframework.context.annotation.Bean;

/**
 * Hall Booking backend.
 *
 * <ul>
 *   <li>{@code /api/**}: REST API for the frontend (start bookings, task inbox, live status, calendar).</li>
 *   <li>{@code /register/**}: the booking register the BPMN's REST connectors call (H2/PostgreSQL via JPA).</li>
 *   <li>Job workers ({@code @JobWorker}) for the job types in the BPMN: validate-booking, send-reminder,
 *       record-notification.</li>
 * </ul>
 */
@SpringBootApplication
@ConfigurationPropertiesScan
public class HallBookingApplication {

  public static void main(String[] args) {
    SpringApplication.run(HallBookingApplication.class, args);
  }

  /** The clock used for "is this date in the past?"; replaced by a fixed clock in tests. */
  @Bean
  Clock clock() {
    return Clock.systemDefaultZone();
  }
}
