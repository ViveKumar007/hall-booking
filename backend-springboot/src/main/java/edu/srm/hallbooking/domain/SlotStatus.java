package edu.srm.hallbooking.domain;

/** PENDING while the slot is held for an approval, CONFIRMED once approved. Rejected/expired slots are deleted. */
public enum SlotStatus {
  PENDING,
  CONFIRMED
}
