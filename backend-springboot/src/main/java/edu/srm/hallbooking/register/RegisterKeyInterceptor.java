package edu.srm.hallbooking.register;

import edu.srm.hallbooking.config.AppProperties;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.lang.NonNull;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * The booking register is called by machines (Camunda's REST connectors), not by signed-in people: they prove it with
 * the shared key REGISTER_API_KEY, sent as the X-Register-Key header ({{secrets.REGISTER_API_KEY}} in the BPMN).
 */
@Component
public class RegisterKeyInterceptor implements HandlerInterceptor, WebMvcConfigurer {

  public static final String HEADER = "X-Register-Key";

  private final AppProperties props;

  public RegisterKeyInterceptor(AppProperties props) {
    this.props = props;
  }

  @Override
  public void addInterceptors(@NonNull InterceptorRegistry registry) {
    registry.addInterceptor(this).addPathPatterns("/register/**").order(-10); // before the outage switch
  }

  @Override
  public boolean preHandle(@NonNull HttpServletRequest request, @NonNull HttpServletResponse response,
      @NonNull Object handler) throws Exception {
    String key = props.registerKey();
    if (key == null || key.isBlank()) {
      return true; // no key configured: local tests only
    }
    String sent = request.getHeader(HEADER);
    boolean ok = sent != null && MessageDigest.isEqual(sent.getBytes(StandardCharsets.UTF_8), key.getBytes(StandardCharsets.UTF_8));
    if (!ok) {
      response.setStatus(HttpStatus.UNAUTHORIZED.value());
      response.setContentType(MediaType.APPLICATION_JSON_VALUE);
      response.getWriter().write("{\"error\":\"Missing or wrong " + HEADER + "\"}");
    }
    return ok;
  }
}
