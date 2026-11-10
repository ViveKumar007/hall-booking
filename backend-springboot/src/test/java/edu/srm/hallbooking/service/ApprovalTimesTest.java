package edu.srm.hallbooking.service;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** The approvalTimes variable: timers for the BPMN, words for the emails. */
class ApprovalTimesTest {

  @Test
  void durationsInWords() {
    assertThat(ApprovalTimes.words(Duration.parse("P1D"))).isEqualTo("1 day");
    assertThat(ApprovalTimes.words(Duration.ofHours(23))).isEqualTo("23 hours");
    assertThat(ApprovalTimes.words(Duration.parse("PT1H30M"))).isEqualTo("1 hour 30 minutes");
    assertThat(ApprovalTimes.words(Duration.ofMinutes(1))).isEqualTo("1 minute");
  }

  @Test
  void oneDayWithAReminderAfterOneHourLeaves23Hours() {
    Map<String, Object> v = ApprovalTimes.variable(Duration.ofDays(1), Duration.ofHours(1));

    assertThat(Duration.parse((String) v.get("timeout"))).isEqualTo(Duration.ofDays(1));
    assertThat(v).containsEntry("reminder", "PT1H").containsEntry("timeoutText", "1 day")
        .containsEntry("reminderText", "1 hour").containsEntry("leftText", "23 hours");
    assertThat(ApprovalTimes.timeoutOf(Map.of("approvalTimes", v), Duration.ZERO)).isEqualTo(Duration.ofDays(1));
    assertThat(ApprovalTimes.timeoutOf(Map.of(), Duration.ofMinutes(2))).isEqualTo(Duration.ofMinutes(2));
  }
}
