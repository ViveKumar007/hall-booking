package edu.srm.hallbooking.service;

import edu.srm.hallbooking.camunda.CamundaGateway;
import edu.srm.hallbooking.config.AppProperties;
import edu.srm.hallbooking.register.RegisterMode;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.stereotype.Service;

/** The status lights at the top of the pages: Camunda, the booking register, the job workers, the mail server. */
@Service
public class HealthService {

  private final CamundaGateway camunda;
  private final RegisterMode registerMode;
  private final AppProperties props;

  public HealthService(CamundaGateway camunda, RegisterMode registerMode, AppProperties props) {
    this.camunda = camunda;
    this.registerMode = registerMode;
    this.props = props;
  }

  public Map<String, Object> health() {
    boolean camundaUp = camunda.isUp();
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("camunda", camundaUp);
    m.put("bookings", registerMode.get() != RegisterMode.Mode.DOWN);
    // The job workers run inside this application; they can work whenever Camunda answers.
    m.put("worker", camundaUp);
    m.put("mail", mailUp());
    m.put("registerMode", registerMode.get().name());
    return m;
  }

  private volatile long mailCheckedAt;
  private volatile boolean mailUp;

  /** The pages poll every few seconds; the SMTP port is checked at most every 30 s, so the mail log stays quiet. */
  private boolean mailUp() {
    long now = System.currentTimeMillis();
    if (now - mailCheckedAt > 30_000) {
      mailUp = reachable(props.smtpHost(), props.smtpPort());
      mailCheckedAt = now;
    }
    return mailUp;
  }

  private static boolean reachable(String host, int port) {
    try (Socket socket = new Socket()) {
      socket.connect(new InetSocketAddress(host, port), 1000);
      return true;
    } catch (IOException e) {
      return false;
    }
  }
}
