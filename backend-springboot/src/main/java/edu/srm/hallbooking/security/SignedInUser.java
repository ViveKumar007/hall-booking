package edu.srm.hallbooking.security;

import java.util.Set;
import java.util.TreeSet;

/** The person behind a request: their Google account and roles (admin, and/or approver roles). */
public record SignedInUser(String email, String name, String picture, Set<String> roles) {

  public boolean isAdmin() {
    return roles.contains(AccountService.ADMIN);
  }

  public boolean holds(String role) {
    return role != null && roles.contains(role);
  }

  /** The approver roles (admin-office, dean, hod, lab-incharge) this person decides for. */
  public Set<String> approverRoles() {
    Set<String> r = new TreeSet<>(roles);
    r.remove(AccountService.ADMIN);
    return r;
  }
}
