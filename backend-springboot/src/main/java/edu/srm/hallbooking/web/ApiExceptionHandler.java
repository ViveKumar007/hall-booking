package edu.srm.hallbooking.web;

import io.camunda.client.api.command.ClientException;
import io.camunda.client.api.command.ClientHttpException;
import io.camunda.client.api.command.ClientStatusException;
import io.grpc.Status;
import java.util.LinkedHashMap;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/**
 * Turns errors into {error, service, fields} with a fitting status. The frontend relies on two of them: 404 while
 * a just-started request is not yet searchable (it retries), and 404/409 when a task was already completed.
 */
@RestControllerAdvice(basePackages = {"edu.srm.hallbooking.web", "edu.srm.hallbooking.security"})
public class ApiExceptionHandler {

  private static final Logger log = LoggerFactory.getLogger(ApiExceptionHandler.class);

  @ExceptionHandler(ApiException.class)
  ResponseEntity<Map<String, Object>> api(ApiException e) {
    return body(e.status(), e.getMessage(), e.service(), e.fields());
  }

  @ExceptionHandler(ClientHttpException.class)
  ResponseEntity<Map<String, Object>> camundaHttp(ClientHttpException e) {
    return switch (e.code()) {
      case 404 -> body(HttpStatus.NOT_FOUND,
          "Camunda has no record of that (yet). A request that was just sent can take a few seconds to appear.", "camunda", null);
      case 409 -> body(HttpStatus.CONFLICT, "That task was already completed or has expired.", "camunda", null);
      default -> body(HttpStatus.BAD_GATEWAY, "Camunda answered " + e.code() + ": " + e.getMessage(), "camunda", null);
    };
  }

  @ExceptionHandler(ClientStatusException.class)
  ResponseEntity<Map<String, Object>> camundaGrpc(ClientStatusException e) {
    Status.Code code = e.getStatusCode();
    if (code == Status.Code.NOT_FOUND) {
      return body(HttpStatus.NOT_FOUND, "Camunda has no record of that: " + e.getMessage(), "camunda", null);
    }
    if (code == Status.Code.UNAVAILABLE || code == Status.Code.DEADLINE_EXCEEDED) {
      return unreachable();
    }
    return body(HttpStatus.BAD_GATEWAY, "Camunda refused the request: " + e.getMessage(), "camunda", null);
  }

  @ExceptionHandler(ClientException.class)
  ResponseEntity<Map<String, Object>> camunda(ClientException e) {
    log.debug("Camunda call failed", e);
    return unreachable();
  }

  @ExceptionHandler(HttpMessageNotReadableException.class)
  ResponseEntity<Map<String, Object>> unreadable(HttpMessageNotReadableException e) {
    return body(HttpStatus.BAD_REQUEST, "The request body is not valid JSON.", "app", null);
  }

  private static ResponseEntity<Map<String, Object>> unreachable() {
    return body(HttpStatus.SERVICE_UNAVAILABLE, "Camunda is not reachable. Start it with start-camunda.cmd.", "camunda", null);
  }

  private static ResponseEntity<Map<String, Object>> body(HttpStatus status, String error, String service,
      Map<String, String> fields) {
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("error", error);
    m.put("service", service);
    if (fields != null) {
      m.put("fields", fields);
    }
    return ResponseEntity.status(status).header("Cache-Control", "no-store").body(m);
  }
}
