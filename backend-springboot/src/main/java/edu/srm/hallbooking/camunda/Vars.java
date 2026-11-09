package edu.srm.hallbooking.camunda;

import java.util.List;
import java.util.Map;
import java.util.Objects;

/** Small helpers for reading process variables, which arrive as nested JSON maps and lists. */
public final class Vars {

  private Vars() {}

  /** The value at a path, e.g. {@code get(vars, "decision", "outcome")}; null when any step is missing. */
  public static Object get(Map<String, Object> vars, String... path) {
    Object current = vars;
    for (String key : path) {
      if (!(current instanceof Map<?, ?> map)) {
        return null;
      }
      current = map.get(key);
    }
    return current;
  }

  public static String str(Map<String, Object> vars, String... path) {
    Object value = get(vars, path);
    return value == null ? null : String.valueOf(value);
  }

  public static boolean isTrue(Map<String, Object> vars, String... path) {
    return Boolean.TRUE.equals(get(vars, path));
  }

  @SuppressWarnings("unchecked")
  public static List<Object> list(Map<String, Object> vars, String... path) {
    Object value = get(vars, path);
    return value instanceof List<?> l ? (List<Object>) l : List.of();
  }

  @SuppressWarnings("unchecked")
  public static List<Map<String, Object>> maps(Map<String, Object> vars, String... path) {
    return list(vars, path).stream()
        .filter(Map.class::isInstance)
        .map(o -> (Map<String, Object>) o)
        .toList();
  }

  public static List<String> strings(Map<String, Object> vars, String... path) {
    return list(vars, path).stream().filter(Objects::nonNull).map(String::valueOf).toList();
  }

  public static Integer integer(Map<String, Object> vars, String... path) {
    Object value = get(vars, path);
    return value instanceof Number n ? n.intValue() : null;
  }

  /** "BK-14, BK-15" from the heldSlots variable, or null when nothing was held. */
  public static String refs(Map<String, Object> vars) {
    if (!(get(vars, "heldSlots") instanceof List<?>)) {
      return null;
    }
    return String.join(", ", maps(vars, "heldSlots").stream().map(h -> String.valueOf(h.get("ref"))).toList());
  }

  /** "1 session", "2 sessions". */
  public static String count(int n, String word) {
    return n + " " + word + (n == 1 ? "" : "s");
  }
}
