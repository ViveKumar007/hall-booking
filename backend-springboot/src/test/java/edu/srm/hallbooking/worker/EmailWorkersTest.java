package edu.srm.hallbooking.worker;

import static org.assertj.core.api.Assertions.assertThat;

import edu.srm.hallbooking.config.AppProperties;
import edu.srm.hallbooking.security.AccountService;
import edu.srm.hallbooking.worker.EmailWorkers.RecipientsInput;
import edu.srm.hallbooking.worker.EmailWorkers.RecipientsOutput;
import org.junit.jupiter.api.Test;

/** Find recipients: a role becomes the accounts holding it; the link becomes a full URL. */
class EmailWorkersTest {

  private static EmailWorkers workers(String accounts) {
    AppProperties props = new AppProperties(null, false, null, java.time.Duration.ofDays(1), java.time.Duration.ofHours(1), null, 0, null, accounts, null, false,
        "http://localhost:8090/");
    return new EmailWorkers(new AccountService(props), props);
  }

  private final EmailWorkers workers = workers(
      "dean@college.edu=dean+admin;office@college.edu=admin-office+hod;lab@college.edu=lab-incharge");

  @Test
  void aRoleGoesToEveryoneHoldingIt() {
    RecipientsOutput out = workers.resolveRecipients(new RecipientsInput(null, "hod", "/#/inbox"));

    assertThat(out.recipients()).isEqualTo("office@college.edu");
    assertThat(out.recipientCount()).isEqualTo(1);
    assertThat(out.linkUrl()).isEqualTo("http://localhost:8090/#/inbox");
    assertThat(out.emailStatus()).isEqualTo("PENDING");
  }

  @Test
  void theRequesterGetsTheirOwnAddress() {
    RecipientsOutput out = workers.resolveRecipients(new RecipientsInput(" Student@Gmail.com ", null, null));

    assertThat(out.recipients()).isEqualTo("student@gmail.com");
    assertThat(out.linkUrl()).isNull();
  }

  @Test
  void aRoleNobodyHoldsGoesToTheAdmins() {
    RecipientsOutput out = workers("dean@college.edu=dean+admin").resolveRecipients(
        new RecipientsInput(null, "lab-incharge", "/#/inbox"));

    assertThat(out.recipients()).isEqualTo("dean@college.edu");
    assertThat(out.recipientNote()).contains("Lab in-charge");
  }

  @Test
  void withNoAccountsSetUpNobodyIsEmailed() {
    RecipientsOutput out = workers("").resolveRecipients(new RecipientsInput(null, "dean", "/#/inbox"));

    assertThat(out.recipientCount()).isZero();
    assertThat(out.recipients()).isEmpty();
    assertThat(out.emailStatus()).isEqualTo("NO_RECIPIENT");
  }
}
