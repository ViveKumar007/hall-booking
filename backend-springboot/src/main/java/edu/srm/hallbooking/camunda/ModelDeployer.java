package edu.srm.hallbooking.camunda;

import edu.srm.hallbooking.config.AppProperties;
import io.camunda.client.CamundaClient;
import io.camunda.client.api.command.DeployResourceCommandStep1.DeployResourceCommandStep2;
import io.camunda.client.api.response.DeploymentEvent;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;

/**
 * Deploys the decision, the forms and both processes at startup, in one deployment, so the engine always runs the
 * models in the repository. Camunda only creates a new version for files that changed.
 */
@Component
public class ModelDeployer implements ApplicationRunner {

  private static final Logger log = LoggerFactory.getLogger(ModelDeployer.class);

  /** Deployment order matters only for readability: one deployment is atomic. */
  static final List<String> FILES = List.of(
      "decide-approver.dmn",
      "booking-request-form.form",
      "approval-form.form",
      "service-fix-form.form",
      "hall-approval.bpmn",
      "hall-booking.bpmn");

  private final CamundaClient client;
  private final AppProperties props;

  public ModelDeployer(CamundaClient client, AppProperties props) {
    this.client = client;
    this.props = props;
  }

  @Override
  public void run(ApplicationArguments args) {
    if (!props.deployModels()) {
      log.info("Model deployment switched off (app.deploy-models=false)");
      return;
    }
    Path dir = Path.of(props.modelsDir()).toAbsolutePath().normalize();
    List<Path> files = FILES.stream().map(dir::resolve).toList();
    List<Path> missing = files.stream().filter(f -> !Files.isRegularFile(f)).toList();
    if (!missing.isEmpty()) {
      log.warn("Not deploying: missing {}", missing);
      return;
    }
    try {
      DeployResourceCommandStep2 command = client.newDeployResourceCommand().addResourceFile(files.get(0).toString());
      for (Path f : files.subList(1, files.size())) {
        command = command.addResourceFile(f.toString());
      }
      DeploymentEvent deployed = command.send().join();
      log.info("Deployed from {}: {}", dir, deployed.getProcesses().stream()
          .map(p -> p.getBpmnProcessId() + " v" + p.getVersion()).collect(Collectors.joining(", ")));
    } catch (RuntimeException e) {
      log.warn("Could not deploy the models (is Camunda running?): {}", e.getMessage());
    }
  }
}
