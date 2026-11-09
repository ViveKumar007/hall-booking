package edu.srm.hallbooking.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;

/**
 * A message the workflow produced: the requester's outcome notice (written by the record-notification worker after
 * the Email connector tried to send it) or a reminder to an approver (send-reminder worker).
 */
@Entity
@Table(name = "notification")
public class Notification {

  @Id
  @GeneratedValue(strategy = GenerationType.IDENTITY)
  private Long id;

  @Enumerated(EnumType.STRING)
  @Column(nullable = false, length = 20)
  private NotificationKind kind;

  @Column(name = "recipient")
  private String to;

  private String subject;

  @Column(length = 4000)
  private String message;

  private String bookingRef;

  private Long processInstanceKey;

  /** SENT or FAILED for outcome notices (what the Email connector reported); null for reminders. */
  @Column(length = 20)
  private String emailStatus;

  @Column(length = 4000)
  private String emailError;

  private Instant sentAt;

  protected Notification() {}

  public Notification(NotificationKind kind, String to, String subject, String message, String bookingRef,
      Long processInstanceKey, String emailStatus, String emailError, Instant sentAt) {
    this.kind = kind;
    this.to = to;
    this.subject = subject;
    this.message = message;
    this.bookingRef = bookingRef;
    this.processInstanceKey = processInstanceKey;
    this.emailStatus = emailStatus;
    this.emailError = emailError;
    this.sentAt = sentAt;
  }

  public Long getId() { return id; }
  public NotificationKind getKind() { return kind; }
  public String getTo() { return to; }
  public String getSubject() { return subject; }
  public String getMessage() { return message; }
  public String getBookingRef() { return bookingRef; }
  public Long getProcessInstanceKey() { return processInstanceKey; }
  public String getEmailStatus() { return emailStatus; }
  public String getEmailError() { return emailError; }
  public Instant getSentAt() { return sentAt; }
}
