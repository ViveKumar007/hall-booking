package edu.srm.hallbooking.security;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.oauth2.client.oidc.userinfo.OidcUserRequest;
import org.springframework.security.oauth2.client.oidc.userinfo.OidcUserService;
import org.springframework.security.oauth2.core.OAuth2AuthenticationException;
import org.springframework.security.oauth2.core.OAuth2Error;
import org.springframework.security.oauth2.core.oidc.user.DefaultOidcUser;
import org.springframework.security.oauth2.core.oidc.user.OidcUser;
import org.springframework.stereotype.Service;

/**
 * Sign in with Google (OpenID Connect). Google confirms who the person is; this accepts the login only when Google
 * reports the email address as verified, then attaches the account's roles.
 */
@Service
public class GoogleUserService extends OidcUserService {

  private static final Logger log = LoggerFactory.getLogger(GoogleUserService.class);

  private final SignInService signIn;

  public GoogleUserService(SignInService signIn) {
    this.signIn = signIn;
  }

  @Override
  public OidcUser loadUser(OidcUserRequest request) throws OAuth2AuthenticationException {
    OidcUser google = super.loadUser(request);
    String email = google.getEmail();
    if (email == null || !Boolean.TRUE.equals(google.getEmailVerified())) {
      log.warn("Sign-in refused: Google account without a verified email ({})", email);
      throw new OAuth2AuthenticationException(new OAuth2Error("email_not_verified",
          "Your Google account's email address is not verified.", null));
    }
    signIn.record(email, google.getFullName(), google.getPicture());
    log.info("Signed in with Google: {} {}", email, signIn.authoritiesFor(email));
    return new DefaultOidcUser(signIn.authoritiesFor(email), google.getIdToken(), google.getUserInfo(), "email");
  }
}
