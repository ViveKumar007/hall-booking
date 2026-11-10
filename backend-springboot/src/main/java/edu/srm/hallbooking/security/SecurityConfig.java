package edu.srm.hallbooking.security;

import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.logout.HttpStatusReturningLogoutSuccessHandler;
import org.springframework.security.web.authentication.www.BasicAuthenticationFilter;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.security.web.context.SecurityContextRepository;
import org.springframework.security.web.csrf.CookieCsrfTokenRepository;
import org.springframework.security.web.util.matcher.RequestMatcher;

/**
 * Who may call what.
 *
 * <ul>
 *   <li>Sign in with Google: {@code /oauth2/authorization/google}, back to {@code /} afterwards.</li>
 *   <li>The pages, {@code /api/meta}, {@code /api/health} and {@code /api/auth/**}: open to everyone.</li>
 *   <li>{@code /register/**}: Camunda's REST connectors, checked by {@code RegisterKeyInterceptor} (shared key).</li>
 *   <li>{@code /api/demo/**}, {@code /api/notifications}, the H2 console: admins only.</li>
 *   <li>Everything else under {@code /api}: signed in; finer rules (own requests, own approver role) in the services.</li>
 * </ul>
 */
@Configuration
@EnableWebSecurity
public class SecurityConfig {

  private static final RequestMatcher API = r -> r.getRequestURI().startsWith(r.getContextPath() + "/api/");

  /** Keeps the login in the HTTP session (also used by the test-only dev login). */
  @Bean
  SecurityContextRepository securityContextRepository() {
    return new HttpSessionSecurityContextRepository();
  }

  @Bean
  SecurityFilterChain filterChain(HttpSecurity http, GoogleUserService googleUsers,
      SecurityContextRepository contexts) throws Exception {
    http
        .securityContext(c -> c.securityContextRepository(contexts))
        .authorizeHttpRequests(a -> a
            .requestMatchers("/api/meta", "/api/health", "/api/auth/**").permitAll()
            .requestMatchers("/register/**", "/actuator/health").permitAll()
            .requestMatchers("/api/demo/**", "/api/notifications", "/h2-console/**").hasAuthority("ROLE_admin")
            .requestMatchers("/api/**").authenticated()
            .anyRequest().permitAll()) // the React app's files
        .oauth2Login(o -> o
            .loginPage("/")
            .userInfoEndpoint(u -> u.oidcUserService(googleUsers))
            .defaultSuccessUrl("/", true)
            .failureUrl("/?login=failed"))
        .logout(l -> l
            .logoutUrl("/api/auth/logout")
            .logoutSuccessHandler(new HttpStatusReturningLogoutSuccessHandler(HttpStatus.NO_CONTENT)))
        // The API answers 401/403 as JSON instead of redirecting to a login page; the React app shows its own.
        .exceptionHandling(e -> e
            .defaultAuthenticationEntryPointFor((req, res, ex) -> json(res, 401, "Sign in with Google first."), API)
            .defaultAccessDeniedHandlerFor((req, res, ex) -> json(res, 403, "You do not have access to that."), API))
        .csrf(c -> c
            .csrfTokenRepository(CookieCsrfTokenRepository.withHttpOnlyFalse())
            .csrfTokenRequestHandler(new SpaCsrf.RequestHandler())
            .ignoringRequestMatchers("/register/**", "/h2-console/**"))
        .addFilterAfter(new SpaCsrf.CookieFilter(), BasicAuthenticationFilter.class)
        .headers(h -> h.frameOptions(f -> f.sameOrigin())); // the H2 console uses frames
    return http.build();
  }

  private static void json(HttpServletResponse res, int status, String message) throws IOException {
    res.setStatus(status);
    res.setContentType(MediaType.APPLICATION_JSON_VALUE);
    res.getWriter().write("{\"error\":\"" + message + "\",\"service\":\"auth\"}");
  }
}
