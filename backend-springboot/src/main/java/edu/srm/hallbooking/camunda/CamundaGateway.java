package edu.srm.hallbooking.camunda;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.camunda.client.CamundaClient;
import io.camunda.client.api.search.enums.ElementInstanceState;
import io.camunda.client.api.search.enums.ElementInstanceType;
import io.camunda.client.api.search.enums.UserTaskState;
import io.camunda.client.api.search.response.ElementInstance;
import io.camunda.client.api.search.response.ProcessInstance;
import io.camunda.client.api.search.response.UserTask;
import io.camunda.client.api.search.response.Variable;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.TimeUnit;
import org.springframework.stereotype.Component;

/**
 * Everything the backend asks Camunda, through the official Camunda Java client (no hand-written REST calls):
 * starting a booking, completing user tasks, and the searches behind the live status tracker and the inbox.
 */
@Component
public class CamundaGateway {

  public static final String BOOKING_PROCESS = "hall-booking";
  public static final String APPROVAL_PROCESS = "hall-approval";

  /** Variables kept on an inner scope that the pages still need (the error boundary's copy). */
  private static final Set<String> FROM_INNER_SCOPES = Set.of("serviceError");

  private final CamundaClient client;
  private final ObjectMapper json;

  public CamundaGateway(CamundaClient client, ObjectMapper json) {
    this.client = client;
    this.json = json;
  }

  /** Starts hall-booking (latest version) with the start payload; returns the process instance key. */
  public long startBooking(Map<String, Object> variables) {
    return client.newCreateInstanceCommand()
        .bpmnProcessId(BOOKING_PROCESS)
        .latestVersion()
        .variables(variables)
        .send()
        .join()
        .getProcessInstanceKey();
  }

  public ProcessInstance instance(long processInstanceKey) {
    return client.newProcessInstanceGetRequest(processInstanceKey).send().join();
  }

  /**
   * The Hall Approval instances a booking's Call Activity started, oldest first (one per approver asked). The booking
   * also calls Send email; those children are left out.
   */
  public List<ProcessInstance> approvals(long parentKey) {
    return client.newProcessInstanceSearchRequest()
        .filter(f -> f.parentProcessInstanceKey(parentKey).processDefinitionId(APPROVAL_PROCESS))
        .sort(s -> s.startDate().asc())
        .page(p -> p.limit(20))
        .send()
        .join()
        .items();
  }

  /**
   * Process-level variables of one instance, parsed from JSON. Local variables of tasks, multi-instance iterations
   * and the sub-process are skipped, except {@link #FROM_INNER_SCOPES}. Truncated values are fetched in full.
   */
  public Map<String, Object> variables(long processInstanceKey) {
    List<Variable> items = client.newVariableSearchRequest()
        .filter(f -> f.processInstanceKey(processInstanceKey))
        .page(p -> p.limit(200))
        .send()
        .join()
        .items();
    Map<String, Object> vars = new LinkedHashMap<>();
    for (Variable v : items) {
      boolean inner = v.getScopeKey() != null && v.getScopeKey() != processInstanceKey;
      if (inner && (!FROM_INNER_SCOPES.contains(v.getName()) || vars.containsKey(v.getName()))) {
        continue;
      }
      String value = v.getValue();
      if (Boolean.TRUE.equals(v.isTruncated()) && v.getVariableKey() != null) {
        value = client.newVariableGetRequest(v.getVariableKey()).send().join().getValue();
      }
      vars.put(v.getName(), parse(value));
    }
    return vars;
  }

  /**
   * Element instances of one process instance, oldest first. A multi-instance activity appears once as its
   * MULTI_INSTANCE_BODY plus once per item; only the body is kept, so "Check session" over 3 sessions is one step.
   */
  public List<ElementInstance> elements(long processInstanceKey, ElementInstanceState state) {
    List<ElementInstance> items = client.newElementInstanceSearchRequest()
        .filter(f -> {
          f.processInstanceKey(processInstanceKey);
          if (state != null) {
            f.state(state);
          }
        })
        .sort(s -> s.startDate().asc())
        .page(p -> p.limit(200))
        .send()
        .join()
        .items();
    Set<String> bodies = new HashSet<>();
    for (ElementInstance e : items) {
      if (e.getType() == ElementInstanceType.MULTI_INSTANCE_BODY) {
        bodies.add(e.getElementId());
      }
    }
    return items.stream()
        .filter(e -> !bodies.contains(e.getElementId()) || e.getType() == ElementInstanceType.MULTI_INSTANCE_BODY)
        .toList();
  }

  /** Open (CREATED) user tasks of one BPMN element, e.g. User_Approval or User_FixService. */
  public List<UserTask> openTasks(String elementId) {
    return client.newUserTaskSearchRequest()
        .filter(f -> f.elementId(elementId).state(UserTaskState.CREATED))
        .sort(s -> s.creationDate().asc())
        .page(p -> p.limit(100))
        .send()
        .join()
        .items();
  }

  /** One user task by its key (any state). */
  public UserTask task(long userTaskKey) {
    return client.newUserTaskGetRequest(userTaskKey).send().join();
  }

  public void completeTask(long userTaskKey, Map<String, Object> variables) {
    client.newCompleteUserTaskCommand(userTaskKey).variables(variables).send().join();
  }

  /** True when the Zeebe gateway answers within 3 seconds. */
  public boolean isUp() {
    try {
      client.newTopologyRequest().send().join(3, TimeUnit.SECONDS);
      return true;
    } catch (RuntimeException e) {
      return false;
    }
  }

  private Object parse(String value) {
    if (value == null) {
      return null;
    }
    try {
      return json.readValue(value, Object.class);
    } catch (JsonProcessingException e) {
      return value;
    }
  }
}
