package edu.srm.hallbooking.security;

import edu.srm.hallbooking.domain.AppUser;
import edu.srm.hallbooking.repository.AppUserRepository;
import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.stereotype.Service;

/** What happens when someone signs in: their roles become authorities, and the account is recorded. */
@Service
public class SignInService {

  /** Every signed-in person may request bookings. */
  public static final String USER = "ROLE_USER";

  private final AccountService accounts;
  private final AppUserRepository users;
  private final Clock clock;

  public SignInService(AccountService accounts, AppUserRepository users, Clock clock) {
    this.accounts = accounts;
    this.users = users;
    this.clock = clock;
  }

  /** ROLE_USER plus ROLE_&lt;role&gt; for every role of the account (e.g. ROLE_dean, ROLE_admin). */
  public List<GrantedAuthority> authoritiesFor(String email) {
    List<GrantedAuthority> list = new ArrayList<>();
    list.add(new SimpleGrantedAuthority(USER));
    accounts.rolesOf(email).forEach(r -> list.add(new SimpleGrantedAuthority("ROLE_" + r)));
    return list;
  }

  public void record(String email, String name, String picture) {
    Instant now = Instant.now(clock);
    AppUser user = users.findById(AccountService.normalize(email))
        .orElseGet(() -> new AppUser(AccountService.normalize(email)));
    if (user.getFirstLogin() == null) {
      user.setFirstLogin(now);
    }
    user.setLastLogin(now);
    user.setName(name);
    user.setPictureUrl(picture);
    users.save(user);
  }
}
