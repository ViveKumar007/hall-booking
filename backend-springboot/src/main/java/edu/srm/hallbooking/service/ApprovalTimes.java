package edu.srm.hallbooking.service;

import edu.srm.hallbooking.camunda.Vars;
import java.time.Duration;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * The review's two timers, sent with every booking as the process variable approvalTimes: timeout and reminder as ISO
 * 8601 durations (the boundary timers in hall-approval.bpmn use them), plus the same in words for the emails and pages.
 */
public final class ApprovalTimes {

  private ApprovalTimes() {}

  public static Map<String, Object> variable(Duration timeout, Duration reminder) {
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("timeout", timeout.toString());
    m.put("reminder", reminder.toString());
    m.put("timeoutText", words(timeout));
    m.put("reminderText", words(reminder));
    m.put("leftText", words(timeout.minus(reminder)));
    return m;
  }

  /** P1D -> "1 day", PT23H -> "23 hours", PT1H30M -> "1 hour 30 minutes", PT2M -> "2 minutes". */
  public static String words(Duration d) {
    List<String> parts = new ArrayList<>();
    add(parts, d.toDays(), "day");
    add(parts, d.toHoursPart(), "hour");
    add(parts, d.toMinutesPart(), "minute");
    add(parts, d.toSecondsPart(), "second");
    return parts.isEmpty() ? "0 minutes" : String.join(" ", parts);
  }

  /** How long the review of one hall-approval instance lasts (its approvalTimes.timeout), else the fallback. */
  public static Duration timeoutOf(Map<String, Object> approvalVars, Duration fallback) {
    String iso = Vars.str(approvalVars, "approvalTimes", "timeout");
    try {
      return iso == null ? fallback : Duration.parse(iso);
    } catch (DateTimeParseException e) {
      return fallback;
    }
  }

  private static void add(List<String> parts, long n, String unit) {
    if (n > 0) {
      parts.add(n + " " + unit + (n == 1 ? "" : "s"));
    }
  }
}
