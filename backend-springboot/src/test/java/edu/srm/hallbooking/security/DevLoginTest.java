package edu.srm.hallbooking.security;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import edu.srm.hallbooking.config.AppProperties;
import edu.srm.hallbooking.domain.AppUser;
import edu.srm.hallbooking.register.RegisterMode;
import edu.srm.hallbooking.repository.AppUserRepository;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

/** The test-only login (APP_DEVLOGIN_ENABLED=true) signs in like Google would: same roles, kept in the session. */
@WebMvcTest(value = AuthController.class, properties = {
    "app.dev-login-enabled=true", "app.accounts=dean@college.edu=dean+admin;office@college.edu=admin-office"})
@Import({SecurityConfig.class, CurrentUser.class, SignInService.class, AccountService.class, RegisterMode.class})
@EnableConfigurationProperties(AppProperties.class)
class DevLoginTest {

  @Autowired MockMvc mvc;
  @MockitoBean GoogleUserService googleUsers;
  @MockitoBean AppUserRepository users;

  @Test
  void signsInWithTheRolesOfThatAccountAndRemembersItInTheSession() throws Exception {
    MockHttpSession session = new MockHttpSession();
    mvc.perform(post("/api/auth/dev-login").session(session).with(Xsrf.token(mvc))
            .contentType(MediaType.APPLICATION_JSON).content("{\"email\":\"Dean@College.edu\",\"name\":\"Dr. Dean\"}"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.email").value("dean@college.edu"))
        .andExpect(jsonPath("$.admin").value(true));

    mvc.perform(get("/api/auth/me").session(session))
        .andExpect(jsonPath("$.signedIn").value(true))
        .andExpect(jsonPath("$.name").value("Dr. Dean"))
        .andExpect(jsonPath("$.approverRoles[0]").value("dean"));
    verify(users).save(any(AppUser.class));
  }

  @Test
  void anyoneElseIsARequester() throws Exception {
    mvc.perform(post("/api/auth/dev-login").with(Xsrf.token(mvc))
            .contentType(MediaType.APPLICATION_JSON).content("{\"email\":\"student@gmail.com\"}"))
        .andExpect(jsonPath("$.roles.length()").value(0))
        .andExpect(jsonPath("$.admin").value(false));
  }

  @Test
  void needsAnEmailAddress() throws Exception {
    mvc.perform(post("/api/auth/dev-login").with(Xsrf.token(mvc))
            .contentType(MediaType.APPLICATION_JSON).content("{\"email\":\"nobody\"}"))
        .andExpect(status().isBadRequest());
  }
}
