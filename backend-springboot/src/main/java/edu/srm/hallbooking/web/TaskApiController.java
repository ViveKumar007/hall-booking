package edu.srm.hallbooking.web;

import edu.srm.hallbooking.service.TaskService;
import edu.srm.hallbooking.service.TaskService.Kind;
import java.util.List;
import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** The custom Tasklist: approver inbox and service issues. */
@RestController
@RequestMapping("/api/tasks")
public class TaskApiController {

  private final TaskService tasks;

  public TaskApiController(TaskService tasks) {
    this.tasks = tasks;
  }

  public record Decision(Boolean approved, String remarks) {}

  public record ServiceAction(String action) {}

  /** kind=approval (default; role=admin-office|dean|hod|lab-incharge|all) or kind=service. */
  @GetMapping
  public List<Map<String, Object>> open(@RequestParam(defaultValue = "approval") String kind,
      @RequestParam(required = false) String role) {
    return tasks.openTasks("service".equals(kind) ? Kind.SERVICE : Kind.APPROVAL, role);
  }

  @PostMapping("/{key}/decision")
  public Map<String, Boolean> decide(@PathVariable long key, @RequestBody Decision body) {
    tasks.decide(key, body.approved(), body.remarks());
    return Map.of("ok", true);
  }

  @PostMapping("/{key}/service-action")
  public Map<String, Boolean> serviceAction(@PathVariable long key, @RequestBody ServiceAction body) {
    tasks.serviceAction(key, body.action());
    return Map.of("ok", true);
  }
}
