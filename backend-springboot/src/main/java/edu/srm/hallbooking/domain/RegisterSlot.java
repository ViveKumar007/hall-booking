package edu.srm.hallbooking.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.Table;
import java.time.LocalDate;

/**
 * One booked slot in the booking register: what the REST connectors read (Check session), create (Hold slot),
 * confirm and delete. Serialized with the field names the BPMN's FEEL expects: hall, day, startHour, endHour,
 * status, requester. They differ from the process variables (venue, bookingDate) on purpose, so the FEEL filter
 * in Check session never mixes up a booking field with a process variable.
 */
@Entity
@Table(name = "register_slot", indexes = @Index(name = "ix_register_slot_hall_day", columnList = "hall, booking_day"))
public class RegisterSlot {

  @Id
  @GeneratedValue(strategy = GenerationType.IDENTITY)
  private Long id;

  @Column(nullable = false, length = 20)
  private String hall;

  /** Column booking_day: DAY is a reserved word in H2 2.x. The JSON field stays "day". */
  @Column(name = "booking_day", nullable = false)
  private LocalDate day;

  @Column(nullable = false)
  private int startHour;

  @Column(nullable = false)
  private int endHour;

  @Enumerated(EnumType.STRING)
  @Column(nullable = false, length = 20)
  private SlotStatus status;

  private String requester;

  protected RegisterSlot() {}

  public RegisterSlot(String hall, LocalDate day, int startHour, int endHour, SlotStatus status, String requester) {
    this.hall = hall;
    this.day = day;
    this.startHour = startHour;
    this.endHour = endHour;
    this.status = status;
    this.requester = requester;
  }

  public Long getId() { return id; }
  public String getHall() { return hall; }
  public LocalDate getDay() { return day; }
  public int getStartHour() { return startHour; }
  public int getEndHour() { return endHour; }
  public SlotStatus getStatus() { return status; }
  public String getRequester() { return requester; }

  public void setHall(String hall) { this.hall = hall; }
  public void setDay(LocalDate day) { this.day = day; }
  public void setStartHour(int startHour) { this.startHour = startHour; }
  public void setEndHour(int endHour) { this.endHour = endHour; }
  public void setStatus(SlotStatus status) { this.status = status; }
  public void setRequester(String requester) { this.requester = requester; }
}
