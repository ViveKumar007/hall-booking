package edu.srm.hallbooking.register;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.lang.NonNull;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/** Applies {@link RegisterMode} to every /register/** call (the REST connectors' calls). */
@Component
public class RegisterOutageInterceptor implements HandlerInterceptor, WebMvcConfigurer {

  private static final Logger log = LoggerFactory.getLogger(RegisterOutageInterceptor.class);

  private final RegisterMode mode;

  public RegisterOutageInterceptor(RegisterMode mode) {
    this.mode = mode;
  }

  @Override
  public void addInterceptors(@NonNull InterceptorRegistry registry) {
    registry.addInterceptor(this).addPathPatterns("/register/**").excludePathPatterns("/register/reset");
  }

  @Override
  public boolean preHandle(@NonNull HttpServletRequest request, @NonNull HttpServletResponse response,
      @NonNull Object handler) throws Exception {
    switch (mode.get()) {
      case DOWN -> {
        log.info("Register DOWN (demo): {} {} -> 503", request.getMethod(), request.getRequestURI());
        response.setStatus(HttpStatus.SERVICE_UNAVAILABLE.value());
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.getWriter().write("{\"error\":\"Booking register unavailable (demo outage)\"}");
        return false;
      }
      case SLOW -> {
        log.info("Register SLOW (demo): {} {} waits {} s", request.getMethod(), request.getRequestURI(),
            RegisterMode.SLOW_MILLIS / 1000);
        Thread.sleep(RegisterMode.SLOW_MILLIS);
        return true;
      }
      default -> {
        return true;
      }
    }
  }
}
