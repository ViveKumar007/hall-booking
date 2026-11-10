package edu.srm.hallbooking.security;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;

import jakarta.servlet.http.Cookie;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.RequestPostProcessor;

/**
 * Does what the React app does before a POST: read the XSRF-TOKEN cookie (from any GET) and send it back in the
 * X-XSRF-TOKEN header. (Spring Security's csrf() test helper is not used: it swaps the cookie token store for a
 * session one for the rest of the test class, which would hide a broken cookie.)
 */
final class Xsrf {

  private Xsrf() {}

  static RequestPostProcessor token(MockMvc mvc) throws Exception {
    Cookie cookie = mvc.perform(get("/api/auth/me")).andReturn().getResponse().getCookie("XSRF-TOKEN");
    if (cookie == null) {
      throw new AssertionError("No XSRF-TOKEN cookie");
    }
    return request -> {
      request.setCookies(cookie);
      request.addHeader("X-XSRF-TOKEN", cookie.getValue());
      return request;
    };
  }

  /** The cookie alone, as a forged cross-site request would carry it (it cannot read it to set the header). */
  static RequestPostProcessor cookieOnly(MockMvc mvc) throws Exception {
    Cookie cookie = mvc.perform(get("/api/auth/me")).andReturn().getResponse().getCookie("XSRF-TOKEN");
    return request -> {
      request.setCookies(cookie);
      return request;
    };
  }
}
