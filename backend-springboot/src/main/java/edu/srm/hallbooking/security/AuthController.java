package edu.srm.hallbooking.security;

import edu.srm.hallbooking.config.AppProperties;
import edu.srm.hallbooking.web.ApiException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.client.authentication.OAuth2AuthenticationToken;
import org.springframework.security.oauth2.core.oidc.OidcIdToken;
import org.springframework.security.oauth2.core.oidc.user.DefaultOidcUser;
import org.springframework.security.web.context.SecurityContextRepository;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Who is signed in, how to sign in, and the test-only login. Sign-out is POST /api/auth/logout (Spring Security). */
@RestController
@RequestMapping("/api/auth")
public class AuthController {

  private static final Logger log = LoggerFactory.getLogger(AuthController.class);

  private final CurrentUser currentUser;
  private final SignInService signIn;
  private final SecurityContextRepository contexts;
  private final AppProperties props;
  private final String googleClientId;

  public AuthController(CurrentUser currentUser, SignInService signIn, SecurityContextRepository contexts,
      AppProperties props,
      @org.springframework.beans.factory.annotation.Value("${spring.security.oauth2.client.registration.google.client-id}")
      String googleClientId) {
    this.currentUser = currentUser;
    this.signIn = signIn;
    this.contexts = contexts;
    this.props = props;
    this.googleClientId = googleClientId;
  }

  /** {signedIn: false}, or the person with their roles. */
  @GetMapping("/me")
  public Map<String, Object> me() {
    return currentUser.get().<Map<String, Object>>map(u -> {
      Map<String, Object> m = new LinkedHashMap<>();
      m.put("signedIn", true);
      m.put("email", u.email());
      m.put("name", u.name());
      m.put("picture", u.picture());
      m.put("roles", u.roles());
      m.put("admin", u.isAdmin());
      m.put("approverRoles", u.approverRoles());
      return m;
    }).orElse(Map.of("signedIn", false));
  }

  /** What the login page needs: where Google sign-in starts, whether it is set up, whether the test login is on. */
  @GetMapping("/config")
  public Map<String, Object> config() {
    return Map.of(
        "googleLoginUrl", "/oauth2/authorization/google",
        "googleConfigured", googleClientId != null && googleClientId.endsWith(".apps.googleusercontent.com"),
        "devLogin", props.devLoginEnabled());
  }

  public record DevLogin(String email, String name) {}

  /**
   * Test-only login without Google, for automated tests (Google blocks automated sign-ins). Answers 404 unless
   * APP_DEVLOGIN_ENABLED=true. The roles are the same as for a Google login with that email.
   */
  @PostMapping("/dev-login")
  public Map<String, Object> devLogin(@RequestBody DevLogin body, HttpServletRequest request,
      HttpServletResponse response) {
    if (!props.devLoginEnabled()) {
      throw new ApiException(HttpStatus.NOT_FOUND, "Not found.");
    }
    String email = AccountService.normalize(body.email());
    if (!email.contains("@")) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "Enter an email address.");
    }
    String name = body.name() == null || body.name().isBlank() ? email : body.name().trim();
    Instant now = Instant.now();
    OidcIdToken token = OidcIdToken.withTokenValue("dev-login")
        .subject(email).claim("email", email).claim("email_verified", true).claim("name", name)
        .issuedAt(now).expiresAt(now.plusSeconds(8 * 3600)).build();
    var authorities = signIn.authoritiesFor(email);
    var principal = new DefaultOidcUser(authorities, token, "email");
    SecurityContext context = SecurityContextHolder.createEmptyContext();
    context.setAuthentication(new OAuth2AuthenticationToken(principal, authorities, "dev-login"));
    SecurityContextHolder.setContext(context);
    contexts.saveContext(context, request, response);
    signIn.record(email, name, null);
    log.warn("Test-only dev login as {} {}", email, authorities);
    return me();
  }
}
