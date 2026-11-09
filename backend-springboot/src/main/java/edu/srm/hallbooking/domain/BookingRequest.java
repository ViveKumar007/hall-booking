package edu.srm.hallbooking.domain;

import jakarta.persistence.CollectionTable;
import jakarta.persistence.Column;
import jakarta.persistence.ElementCollection;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.OrderColumn;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

/**
 * One booking request (one hall-booking process instance), kept in the database so request lists are a single
 * query instead of many Camunda searches. Created when the API starts a booking, upserted by the validate-booking
 * worker (so bookings started from Tasklist or scripts are recorded too), and completed by record-notification.
 */
@Entity
@Table(name = "booking_request", indexes = @Index(name = "ix_booking_request_email", columnList = "email"))
public class BookingRequest {

  /** The hall-booking process instance key. */
  @Id
  private Long processInstanceKey;

  private String requesterName;

  private String email;

  private Integer attendees;

  @Column(length = 2000)
  private String purpose;

  @ElementCollection(fetch = FetchType.EAGER)
  @CollectionTable(name = "booking_request_session", joinColumns = @JoinColumn(name = "process_instance_key"))
  @OrderColumn(name = "position")
  private List<RequestSession> sessions = new ArrayList<>();

  /** Final outcome (APPROVED, REJECTED, ...), or the validation reason; null while the request is running. */
  @Column(length = 40)
  private String outcome;

  /** The approval chain, comma separated (e.g. "admin-office,lab-incharge"). */
  private String approvers;

  /** Booking references of the held slots, e.g. "BK-14, BK-15". */
  private String bookingRef;

  @Column(length = 20)
  private String emailStatus;

  private Instant createdAt;

  private Instant finishedAt;

  protected BookingRequest() {}

  public BookingRequest(Long processInstanceKey) {
    this.processInstanceKey = processInstanceKey;
  }

  public Long getProcessInstanceKey() { return processInstanceKey; }
  public String getRequesterName() { return requesterName; }
  public String getEmail() { return email; }
  public Integer getAttendees() { return attendees; }
  public String getPurpose() { return purpose; }
  public List<RequestSession> getSessions() { return sessions; }
  public String getOutcome() { return outcome; }
  public String getApprovers() { return approvers; }
  public String getBookingRef() { return bookingRef; }
  public String getEmailStatus() { return emailStatus; }
  public Instant getCreatedAt() { return createdAt; }
  public Instant getFinishedAt() { return finishedAt; }

  public void setRequesterName(String requesterName) { this.requesterName = requesterName; }
  public void setEmail(String email) { this.email = email; }
  public void setAttendees(Integer attendees) { this.attendees = attendees; }
  public void setPurpose(String purpose) { this.purpose = purpose; }
  public void setOutcome(String outcome) { this.outcome = outcome; }
  public void setApprovers(String approvers) { this.approvers = approvers; }
  public void setBookingRef(String bookingRef) { this.bookingRef = bookingRef; }
  public void setEmailStatus(String emailStatus) { this.emailStatus = emailStatus; }
  public void setCreatedAt(Instant createdAt) { this.createdAt = createdAt; }
  public void setFinishedAt(Instant finishedAt) { this.finishedAt = finishedAt; }

  public void replaceSessions(List<RequestSession> newSessions) {
    sessions.clear();
    sessions.addAll(newSessions);
  }
}
