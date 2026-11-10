package edu.srm.hallbooking.security;

import static org.assertj.core.api.Assertions.assertThat;

import edu.srm.hallbooking.config.AppProperties;
import java.util.Set;
import org.junit.jupiter.api.Test;

/** APP_ACCOUNTS: which Google accounts hold which roles. */
class AccountServiceTest {

  private static AccountService accounts(String value) {
    return new AccountService(new AppProperties(null, false, null, java.time.Duration.ofDays(1), java.time.Duration.ofHours(1), null, 0, null, value, null, false, "http://localhost:8090"));
  }

  @Test
  void anAccountCanHoldSeveralRolesAndEmailsAreMatchedWithoutCase() {
    AccountService a = accounts("Dean@College.edu=dean+admin; office@college.edu=admin-office+hod");

    assertThat(a.rolesOf("dean@college.edu")).containsExactly("admin", "dean");
    assertThat(a.rolesOf(" OFFICE@college.edu ")).containsExactly("admin-office", "hod");
    assertThat(a.holdersOf("hod")).containsExactly("office@college.edu");
    assertThat(a.holdersOf("admin")).containsExactly("dean@college.edu");
  }

  @Test
  void everyoneElseIsARequesterOnly() {
    AccountService a = accounts("dean@college.edu=dean");

    assertThat(a.rolesOf("student@gmail.com")).isEmpty();
    assertThat(a.holdersOf("lab-incharge")).isEmpty();
    assertThat(accounts("").rolesOf("dean@college.edu")).isEmpty();
    assertThat(accounts(null).holdersOf("dean")).isEmpty();
  }

  @Test
  void unknownRolesAndBrokenEntriesAreSkipped() {
    AccountService a = accounts("x@college.edu=dean+principal,broken-entry;=hod;y@college.edu=LAB-INCHARGE");

    assertThat(a.rolesOf("x@college.edu")).isEqualTo(Set.of("dean"));
    assertThat(a.rolesOf("y@college.edu")).isEqualTo(Set.of("lab-incharge"));
  }
}
