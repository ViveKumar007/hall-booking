package edu.srm.hallbooking.worker;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import edu.srm.hallbooking.catalog.Catalog;
import edu.srm.hallbooking.config.AppProperties;
import edu.srm.hallbooking.security.AccountService;
import io.camunda.client.annotation.JobWorker;
import io.camunda.client.annotation.VariablesAsType;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/** The job worker of the send-email child process: who gets the email, and the link into the app. */
@Component
public class EmailWorkers {

  private static final Logger log = LoggerFactory.getLogger(EmailWorkers.class);

  /** to = one address, or toRole = an approver role or admin; link = a page of the app such as /#/inbox. */
  @JsonIgnoreProperties(ignoreUnknown = true)
  public record RecipientsInput(String to, String toRole, String link) {}

  /**
   * recipients = comma-separated addresses for the Email connector; emailStatus starts as PENDING (the connector sets
   * SENT, its error boundary FAILED) or NO_RECIPIENT when nobody can be emailed.
   */
  public record RecipientsOutput(String recipients, int recipientCount, String linkUrl, String recipientNote,
      String emailStatus) {}

  private final AccountService accounts;
  private final AppProperties props;

  public EmailWorkers(AccountService accounts, AppProperties props) {
    this.accounts = accounts;
    this.props = props;
  }

  /**
   * resolve-recipients (Find recipients). A role goes to every account holding it (APP_ACCOUNTS); when nobody does,
   * to the admins instead, so a review never waits unseen.
   */
  @JobWorker(type = "resolve-recipients")
  public RecipientsOutput resolveRecipients(@VariablesAsType RecipientsInput in) {
    Set<String> list = new LinkedHashSet<>();
    String note;
    if (in.to() != null && !in.to().isBlank()) {
      list.add(AccountService.normalize(in.to()));
      note = "requester";
    } else if (in.toRole() != null && !in.toRole().isBlank()) {
      list.addAll(accounts.holdersOf(in.toRole()));
      note = roleName(in.toRole());
      if (list.isEmpty() && !AccountService.ADMIN.equals(in.toRole())) {
        list.addAll(accounts.holdersOf(AccountService.ADMIN));
        note = "admins (no account holds the " + roleName(in.toRole()) + " role)";
      }
    } else {
      note = "nobody named";
    }
    List<String> recipients = new ArrayList<>(list);
    String linkUrl = in.link() == null || in.link().isBlank() ? null : trimSlash(props.url()) + in.link();
    log.info("resolve-recipients {} -> {} ({})", in.toRole() != null ? in.toRole() : "address", recipients, note);
    return new RecipientsOutput(String.join(",", recipients), recipients.size(), linkUrl, note,
        recipients.isEmpty() ? "NO_RECIPIENT" : "PENDING");
  }

  private static String roleName(String role) {
    return AccountService.ADMIN.equals(role) ? "admin" : Catalog.roleName(role);
  }

  private static String trimSlash(String url) {
    String u = url == null || url.isBlank() ? "http://localhost:8090" : url.trim();
    return u.endsWith("/") ? u.substring(0, u.length() - 1) : u;
  }
}
