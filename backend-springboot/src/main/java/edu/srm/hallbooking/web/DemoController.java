package edu.srm.hallbooking.web;

import edu.srm.hallbooking.register.RegisterMode;
import edu.srm.hallbooking.service.SeedService;
import java.io.IOException;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Demo and test helpers: restore the seed bookings, and make the booking register fail or slow on purpose. */
@RestController
@RequestMapping("/api/demo")
public class DemoController {

  private final SeedService seed;
  private final RegisterMode registerMode;

  public DemoController(SeedService seed, RegisterMode registerMode) {
    this.seed = seed;
    this.registerMode = registerMode;
  }

  public record ModeChange(String mode) {}

  @PostMapping("/reset")
  public Map<String, Object> reset() throws IOException {
    return Map.of("ok", true, "bookings", seed.reset());
  }

  @GetMapping("/register-mode")
  public Map<String, String> mode() {
    return Map.of("mode", registerMode.get().name());
  }

  /** {mode: UP | DOWN | SLOW}: DOWN triggers the Service down error boundary, SLOW the 30 s timer boundary. */
  @PostMapping("/register-mode")
  public Map<String, String> setMode(@RequestBody ModeChange body) {
    try {
      registerMode.set(RegisterMode.Mode.valueOf(String.valueOf(body.mode()).toUpperCase()));
    } catch (IllegalArgumentException e) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "mode must be UP, DOWN or SLOW.");
    }
    return mode();
  }
}
