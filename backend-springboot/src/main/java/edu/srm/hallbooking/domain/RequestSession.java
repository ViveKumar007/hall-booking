package edu.srm.hallbooking.domain;

import jakarta.persistence.Embeddable;

/** One session of a booking request: venue, date (yyyy-MM-dd) and hours (HH:00), as in the process variables. */
@Embeddable
public class RequestSession {

  private String venue;
  private String bookingDate;
  private String startTime;
  private String endTime;

  protected RequestSession() {}

  public RequestSession(String venue, String bookingDate, String startTime, String endTime) {
    this.venue = venue;
    this.bookingDate = bookingDate;
    this.startTime = startTime;
    this.endTime = endTime;
  }

  public String getVenue() { return venue; }
  public String getBookingDate() { return bookingDate; }
  public String getStartTime() { return startTime; }
  public String getEndTime() { return endTime; }
}
