package edu.srm.hallbooking.security;

import edu.srm.hallbooking.web.ApiException;
import java.util.Optional;
import java.util.Set;
import java.util.TreeSet;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.core.oidc.user.OidcUser;
import org.springframework.stereotype.Component;

/** The signed-in person of the current request, read from Spring Security's context. */
@Component
public class CurrentUser {

  public Optional<SignedInUser> get() {
    Authentication auth = SecurityContextHolder.getContext().getAuthentication();
    if (auth == null || !(auth.getPrincipal() instanceof OidcUser oidc) || oidc.getEmail() == null) {
      return Optional.empty();
    }
    Set<String> roles = new TreeSet<>();
    for (GrantedAuthority a : auth.getAuthorities()) {
      String name = a.getAuthority();
      if (name.startsWith("ROLE_") && !SignInService.USER.equals(name)) {
        roles.add(name.substring("ROLE_".length()));
      }
    }
    return Optional.of(new SignedInUser(AccountService.normalize(oidc.getEmail()), oidc.getFullName(),
        oidc.getPicture(), roles));
  }

  /** The signed-in person, or 401 (the security rules normally answer that before a controller runs). */
  public SignedInUser require() {
    return get().orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "Sign in with Google first."));
  }

  /** 403 unless the signed-in person is an admin. */
  public SignedInUser requireAdmin() {
    SignedInUser user = require();
    if (!user.isAdmin()) {
      throw new ApiException(HttpStatus.FORBIDDEN, "Only an admin can do that.");
    }
    return user;
  }
}
