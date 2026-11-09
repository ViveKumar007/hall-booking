package edu.srm.hallbooking.register;

import java.util.concurrent.atomic.AtomicReference;
import org.springframework.stereotype.Component;

/**
 * How the booking register behaves, switched from the admin page or {@code POST /api/demo/register-mode}:
 * UP (normal), DOWN (every call answers 503: the connector's errorExpression raises BOOKING_SERVICE_DOWN, caught by
 * the error boundary) or SLOW (every call takes 40 s: the 30 s timer boundary on Check availability fires first).
 */
@Component
public class RegisterMode {

  public enum Mode { UP, DOWN, SLOW }

  /** How long a call takes in SLOW mode. Longer than the 30 s timer, shorter than the connector's 60 s read timeout. */
  public static final long SLOW_MILLIS = 40_000;

  private final AtomicReference<Mode> mode = new AtomicReference<>(Mode.UP);

  public Mode get() {
    return mode.get();
  }

  public void set(Mode newMode) {
    mode.set(newMode);
  }
}
