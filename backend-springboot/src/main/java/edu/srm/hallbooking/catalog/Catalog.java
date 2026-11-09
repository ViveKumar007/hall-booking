package edu.srm.hallbooking.catalog;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/** Fixed reference data: venues with capacities, approver roles, and how each outcome is shown. */
public final class Catalog {

  private Catalog() {}

  public record Venue(String id, String name, int capacity) {}

  public record Role(String id, String name) {}

  public record Display(String label, String tone) {}

  public static final List<Venue> VENUES = List.of(
      new Venue("hall-a", "Seminar Hall A", 200),
      new Venue("hall-b", "Seminar Hall B", 150),
      new Venue("lab-1", "Computer Lab 1", 60));

  public static final List<Role> ROLES = List.of(
      new Role("admin-office", "Admin office"),
      new Role("dean", "Dean"),
      new Role("hod", "HOD"),
      new Role("lab-incharge", "Lab in-charge"));

  /** Booking outcomes (the {@code outcome} process variable). Insertion order is kept for the API. */
  public static final Map<String, Display> OUTCOMES = new LinkedHashMap<>();

  static {
    OUTCOMES.put("APPROVED", new Display("Approved", "ok"));
    OUTCOMES.put("REJECTED", new Display("Rejected", "bad"));
    OUTCOMES.put("EXPIRED", new Display("Expired", "idle"));
    OUTCOMES.put("CONFLICT", new Display("Slot taken", "warn"));
    OUTCOMES.put("INVALID_TIME", new Display("Invalid time", "warn"));
    OUTCOMES.put("PAST_DATE", new Display("Date passed", "warn"));
    OUTCOMES.put("OVER_CAPACITY", new Display("Over capacity", "warn"));
    OUTCOMES.put("SERVICE_UNAVAILABLE", new Display("Service unavailable", "bad"));
  }

  public static Optional<Venue> venue(String id) {
    return VENUES.stream().filter(v -> v.id().equals(id)).findFirst();
  }

  public static String roleName(String id) {
    if (id == null) {
      return "";
    }
    return ROLES.stream().filter(r -> r.id().equals(id)).map(Role::name).findFirst().orElse(id);
  }
}
