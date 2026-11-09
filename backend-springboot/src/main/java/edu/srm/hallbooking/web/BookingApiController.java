package edu.srm.hallbooking.web;

import edu.srm.hallbooking.service.BookingService;
import edu.srm.hallbooking.service.BookingService.BookingForm;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/** Booking requests: start one, list them (optionally one requester's), follow one live. */
@RestController
@RequestMapping("/api/bookings")
public class BookingApiController {

  private final BookingService bookings;

  public BookingApiController(BookingService bookings) {
    this.bookings = bookings;
  }

  /** Starts a hall-booking process instance. Returns {key}: the process instance key. */
  @PostMapping
  @ResponseStatus(HttpStatus.CREATED)
  public Map<String, String> start(@RequestBody BookingForm form) {
    return Map.of("key", String.valueOf(bookings.start(form)));
  }

  @GetMapping
  public List<Map<String, Object>> list(@RequestParam(required = false) String email,
      @RequestParam(defaultValue = "25") int limit) {
    return bookings.list(email, limit);
  }

  /** Status, outcome, the live route through both processes, the approval countdown and the email sent. */
  @GetMapping("/{key}")
  public Map<String, Object> detail(@PathVariable long key) {
    return bookings.detail(key);
  }
}
