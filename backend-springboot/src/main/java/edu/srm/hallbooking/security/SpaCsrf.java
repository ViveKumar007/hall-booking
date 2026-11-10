package edu.srm.hallbooking.security;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.function.Supplier;
import org.springframework.lang.NonNull;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.security.web.csrf.CsrfTokenRequestAttributeHandler;
import org.springframework.security.web.csrf.CsrfTokenRequestHandler;
import org.springframework.security.web.csrf.XorCsrfTokenRequestAttributeHandler;
import org.springframework.util.StringUtils;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * CSRF protection for a single-page app (the pattern from the Spring Security reference): the token travels in the
 * XSRF-TOKEN cookie, the React app sends it back in the X-XSRF-TOKEN header on every POST. A page on another site can
 * neither read the cookie nor set the header, so it cannot make the browser act for the signed-in person.
 */
public final class SpaCsrf {

  private SpaCsrf() {}

  /** Accepts the raw token from the header (what the app sends) and the masked one from forms. */
  public static final class RequestHandler implements CsrfTokenRequestHandler {
    private final CsrfTokenRequestHandler plain = new CsrfTokenRequestAttributeHandler();
    private final CsrfTokenRequestHandler xor = new XorCsrfTokenRequestAttributeHandler();

    @Override
    public void handle(HttpServletRequest request, HttpServletResponse response, Supplier<CsrfToken> csrfToken) {
      xor.handle(request, response, csrfToken);
      csrfToken.get(); // load the token now, so the cookie is written
    }

    @Override
    public String resolveCsrfTokenValue(HttpServletRequest request, CsrfToken csrfToken) {
      String header = request.getHeader(csrfToken.getHeaderName());
      return (StringUtils.hasText(header) ? plain : xor).resolveCsrfTokenValue(request, csrfToken);
    }
  }

  /** Makes sure every response carries the XSRF-TOKEN cookie, so the app has it before its first POST. */
  public static final class CookieFilter extends OncePerRequestFilter {
    @Override
    protected void doFilterInternal(@NonNull HttpServletRequest request, @NonNull HttpServletResponse response,
        @NonNull FilterChain chain) throws ServletException, IOException {
      CsrfToken token = (CsrfToken) request.getAttribute(CsrfToken.class.getName());
      if (token != null) {
        token.getToken();
      }
      chain.doFilter(request, response);
    }
  }
}
