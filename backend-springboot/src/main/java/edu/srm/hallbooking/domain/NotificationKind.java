package edu.srm.hallbooking.domain;

public enum NotificationKind {
  /** The requester's notice at the end of a booking (approved, rejected, conflict, ...). */
  OUTCOME,
  /** The 1-minute reminder to an approver who has not decided yet. */
  REMINDER
}
