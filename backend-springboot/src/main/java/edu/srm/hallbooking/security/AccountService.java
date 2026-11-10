package edu.srm.hallbooking.security;

import edu.srm.hallbooking.catalog.Catalog;
import edu.srm.hallbooking.config.AppProperties;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

/**
 * Who holds which role. Read from APP_ACCOUNTS ("email=role+role;email=role", kept in the git-ignored secrets.cmd so
 * real addresses never go into the repository). Everyone can request bookings; listed accounts are also approvers
 * (admin-office, dean, hod, lab-incharge) and/or admin.
 */
@Service
public class AccountService {

  private static final Logger log = LoggerFactory.getLogger(AccountService.class);

  public static final String ADMIN = "admin";

  /** Approver roles (the decide-approver DMN outputs) plus admin. */
  public static final Set<String> KNOWN_ROLES;

  static {
    Set<String> roles = new LinkedHashSet<>();
    Catalog.ROLES.forEach(r -> roles.add(r.id()));
    roles.add(ADMIN);
    KNOWN_ROLES = Collections.unmodifiableSet(roles);
  }

  private final Map<String, Set<String>> rolesByEmail;

  public AccountService(AppProperties props) {
    this.rolesByEmail = parse(props.accounts());
    log.info("Role assignments for {} account(s); everyone else who signs in is a requester", rolesByEmail.size());
  }

  /** "a@x=dean+admin;b@y=lab-incharge" -> {a@x: [dean, admin], b@y: [lab-incharge]}. Unknown roles are skipped. */
  static Map<String, Set<String>> parse(String accounts) {
    Map<String, Set<String>> map = new LinkedHashMap<>();
    if (accounts == null || accounts.isBlank()) {
      return map;
    }
    for (String entry : accounts.split("[;,\\s]+")) {
      int eq = entry.indexOf('=');
      if (eq <= 0) {
        continue;
      }
      String email = normalize(entry.substring(0, eq));
      Set<String> roles = new TreeSet<>();
      for (String role : entry.substring(eq + 1).split("\\+")) {
        String r = role.trim().toLowerCase(Locale.ROOT);
        if (KNOWN_ROLES.contains(r)) {
          roles.add(r);
        } else if (!r.isEmpty()) {
          log.warn("Unknown role '{}' for {} ignored", r, email);
        }
      }
      map.computeIfAbsent(email, k -> new TreeSet<>()).addAll(roles);
    }
    return map;
  }

  public static String normalize(String email) {
    return email == null ? "" : email.trim().toLowerCase(Locale.ROOT);
  }

  /** The roles of one account (empty = requester only). */
  public Set<String> rolesOf(String email) {
    return rolesByEmail.getOrDefault(normalize(email), Set.of());
  }

  /** The accounts holding a role, e.g. who to email about a review waiting for "dean". */
  public List<String> holdersOf(String role) {
    return rolesByEmail.entrySet().stream().filter(e -> e.getValue().contains(role)).map(Map.Entry::getKey).toList();
  }
}
