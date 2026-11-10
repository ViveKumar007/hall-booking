package edu.srm.hallbooking.security;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.oidcLogin;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.cookie;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import edu.srm.hallbooking.config.AppProperties;
import edu.srm.hallbooking.register.RegisterMode;
import edu.srm.hallbooking.repository.NotificationRepository;
import edu.srm.hallbooking.repository.RegisterSlotRepository;
import edu.srm.hallbooking.service.BookingService;
import edu.srm.hallbooking.service.HealthService;
import edu.srm.hallbooking.service.SeedService;
import edu.srm.hallbooking.service.TaskService;
import edu.srm.hallbooking.web.BookingApiController;
import edu.srm.hallbooking.web.DemoController;
import edu.srm.hallbooking.web.InfoController;
import edu.srm.hallbooking.web.TaskApiController;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.RequestPostProcessor;

/** Who may call what: signed out, a requester, an approver, an admin. And CSRF on every POST. */
@WebMvcTest({AuthController.class, BookingApiController.class, TaskApiController.class, DemoController.class,
    InfoController.class})
@Import({SecurityConfig.class, CurrentUser.class, RegisterMode.class})
@EnableConfigurationProperties(AppProperties.class)
class ApiSecurityTest {

  @Autowired MockMvc mvc;
  @MockitoBean GoogleUserService googleUsers;
  @MockitoBean SignInService signIn;
  @MockitoBean BookingService bookings;
  @MockitoBean TaskService tasks;
  @MockitoBean SeedService seed;
  @MockitoBean HealthService health;
  @MockitoBean RegisterSlotRepository slots;
  @MockitoBean NotificationRepository notifications;

  /** Signed in with Google as this account, holding these roles. */
  static RequestPostProcessor as(String email, String... roles) {
    List<GrantedAuthority> authorities = new ArrayList<>();
    authorities.add(new SimpleGrantedAuthority(SignInService.USER));
    for (String role : roles) {
      authorities.add(new SimpleGrantedAuthority("ROLE_" + role));
    }
    return oidcLogin().idToken(t -> t.claim("email", email).claim("name", "Test " + email)).authorities(authorities);
  }

  @Test
  void signedOutTheApiAnswers401AsJsonInsteadOfRedirecting() throws Exception {
    mvc.perform(get("/api/bookings"))
        .andExpect(status().isUnauthorized())
        .andExpect(jsonPath("$.error").value("Sign in with Google first."));
    mvc.perform(get("/api/tasks")).andExpect(status().isUnauthorized());
    mvc.perform(get("/api/calendar")).andExpect(status().isUnauthorized());
  }

  @Test
  void theLoginPageCanAskWhoIsSignedInAndHowToSignIn() throws Exception {
    mvc.perform(get("/api/meta")).andExpect(status().isOk());
    mvc.perform(get("/api/auth/me"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.signedIn").value(false))
        .andExpect(cookie().exists("XSRF-TOKEN")); // the app has the CSRF token before its first POST
    mvc.perform(get("/api/auth/config"))
        .andExpect(jsonPath("$.googleLoginUrl").value("/oauth2/authorization/google"))
        .andExpect(jsonPath("$.devLogin").value(false));
  }

  @Test
  void meShowsTheGoogleAccountAndItsRoles() throws Exception {
    mvc.perform(get("/api/auth/me").with(as("dean@college.edu", "dean", "admin")))
        .andExpect(jsonPath("$.signedIn").value(true))
        .andExpect(jsonPath("$.email").value("dean@college.edu"))
        .andExpect(jsonPath("$.name").value("Test dean@college.edu"))
        .andExpect(jsonPath("$.admin").value(true))
        .andExpect(jsonPath("$.roles.length()").value(2))
        .andExpect(jsonPath("$.approverRoles[0]").value("dean"));
  }

  @Test
  void aBookingIsMadeInTheNameOfTheSignedInAccount() throws Exception {
    when(bookings.start(any(), any())).thenReturn(42L);

    mvc.perform(post("/api/bookings").with(as("student@gmail.com")).with(Xsrf.token(mvc))
            .contentType(MediaType.APPLICATION_JSON).content("{\"email\":\"someone-else@gmail.com\"}"))
        .andExpect(status().isCreated())
        .andExpect(jsonPath("$.key").value("42"));
    verify(bookings).start(any(), argThat(u -> u.email().equals("student@gmail.com") && u.roles().isEmpty()));
  }

  @Test
  void aPostWithoutTheCsrfTokenIsRefused() throws Exception {
    mvc.perform(post("/api/bookings").with(as("student@gmail.com"))
            .contentType(MediaType.APPLICATION_JSON).content("{}"))
        .andExpect(status().isForbidden());
    // A forged request from another site carries the cookie but cannot read it to send the header.
    mvc.perform(post("/api/bookings").with(as("student@gmail.com")).with(Xsrf.cookieOnly(mvc))
            .contentType(MediaType.APPLICATION_JSON).content("{}"))
        .andExpect(status().isForbidden());
    verify(bookings, never()).start(any(), any());
  }

  @Test
  void demoSwitchesAndTheNotificationLogAreForAdminsOnly() throws Exception {
    mvc.perform(post("/api/demo/reset").with(as("dean@college.edu", "dean")).with(Xsrf.token(mvc)))
        .andExpect(status().isForbidden());
    mvc.perform(get("/api/notifications").with(as("student@gmail.com"))).andExpect(status().isForbidden());

    when(seed.reset()).thenReturn(3);
    mvc.perform(post("/api/demo/reset").with(as("admin@college.edu", "admin")).with(Xsrf.token(mvc)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.bookings").value(3));
    mvc.perform(get("/api/notifications").with(as("admin@college.edu", "admin"))).andExpect(status().isOk());
  }

  @Test
  void decisionsArePassedOnWithTheSignedInAccount() throws Exception {
    mvc.perform(post("/api/tasks/7/decision").with(as("dean@college.edu", "dean")).with(Xsrf.token(mvc))
            .contentType(MediaType.APPLICATION_JSON).content("{\"approved\":true,\"remarks\":\"ok\"}"))
        .andExpect(status().isOk());
    verify(tasks).decide(eq(7L), eq(true), eq("ok"), argThat(u -> u.holds("dean")));
  }

  @Test
  void theTestOnlyLoginIsOffUnlessSwitchedOn() throws Exception {
    mvc.perform(post("/api/auth/dev-login").with(Xsrf.token(mvc))
            .contentType(MediaType.APPLICATION_JSON).content("{\"email\":\"dean@college.edu\"}"))
        .andExpect(status().isNotFound());
  }

  @Test
  void signingOutAnswers204() throws Exception {
    mvc.perform(post("/api/auth/logout").with(as("student@gmail.com")).with(Xsrf.token(mvc)))
        .andExpect(status().isNoContent());
  }

  @Test
  void signingInStartsAtGoogle() throws Exception {
    mvc.perform(get("/oauth2/authorization/google"))
        .andExpect(status().is3xxRedirection())
        .andExpect(result -> {
          String location = result.getResponse().getHeader("Location");
          if (location == null || !location.startsWith("https://accounts.google.com/")) {
            throw new AssertionError("Expected a redirect to Google, got " + location);
          }
        });
  }
}
