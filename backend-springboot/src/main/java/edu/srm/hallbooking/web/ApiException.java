package edu.srm.hallbooking.web;

import java.util.Map;
import org.springframework.http.HttpStatus;

/** An error the API reports as {error, service, fields} with the given HTTP status. */
public class ApiException extends RuntimeException {

  private final HttpStatus status;
  private final String service;
  private final Map<String, String> fields;

  public ApiException(HttpStatus status, String message) {
    this(status, message, "app", null);
  }

  public ApiException(HttpStatus status, String message, String service, Map<String, String> fields) {
    super(message);
    this.status = status;
    this.service = service;
    this.fields = fields;
  }

  public HttpStatus status() { return status; }
  public String service() { return service; }
  public Map<String, String> fields() { return fields; }
}
