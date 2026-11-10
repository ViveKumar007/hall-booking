package edu.srm.hallbooking.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import edu.srm.hallbooking.camunda.CamundaGateway;
import edu.srm.hallbooking.config.AppProperties;
import edu.srm.hallbooking.security.SignedInUser;
import edu.srm.hallbooking.web.ApiException;
import io.camunda.client.api.search.enums.UserTaskState;
import io.camunda.client.api.search.response.UserTask;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;

/** Only the person holding a review's approver role decides it; service issues are for admins. */
class TaskServiceTest {

  private final CamundaGateway camunda = mock(CamundaGateway.class);
  private final TaskService tasks = new TaskService(camunda,
      new AppProperties(null, false, null, java.time.Duration.ofDays(1), java.time.Duration.ofHours(1), null, 0, null, null, null, false, "http://localhost:8090"));

  private static SignedInUser user(String email, String... roles) {
    return new SignedInUser(email, email, null, Set.of(roles));
  }

  private static UserTask task(String elementId, UserTaskState state) {
    UserTask t = mock(UserTask.class);
    when(t.getElementId()).thenReturn(elementId);
    when(t.getState()).thenReturn(state);
    when(t.getProcessInstanceKey()).thenReturn(5L);
    return t;
  }

  @BeforeEach
  void aReviewForTheDean() {
    UserTask review = task("User_Approval", UserTaskState.CREATED);
    when(camunda.task(7L)).thenReturn(review);
    when(camunda.variables(5L)).thenReturn(Map.of("approver", "dean"));
  }

  @Test
  void theDeanDecidesAndIsRecordedAsTheDecider() {
    tasks.decide(7L, true, " fine ", user("dean@college.edu", "dean"));

    verify(camunda).completeTask(7L, Map.of("approved", true, "remarks", "fine", "decidedBy", "dean@college.edu"));
  }

  @Test
  void anotherApproverOrAnAdminWithoutTheRoleCannotDecide() {
    for (SignedInUser someone : List.of(user("hod@college.edu", "hod"), user("admin@college.edu", "admin"),
        user("student@gmail.com"))) {
      assertThatThrownBy(() -> tasks.decide(7L, false, "", someone))
          .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.status()).isEqualTo(HttpStatus.FORBIDDEN));
    }
    verify(camunda, never()).completeTask(anyLong(), anyMap());
  }

  @Test
  void aServiceIssueTaskCannotBeDecidedAsAReview() {
    UserTask issue = task("User_FixService", UserTaskState.CREATED);
    when(camunda.task(8L)).thenReturn(issue);

    assertThatThrownBy(() -> tasks.decide(8L, true, "", user("dean@college.edu", "dean")))
        .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.status()).isEqualTo(HttpStatus.NOT_FOUND));
  }

  @Test
  void serviceIssuesAreForAdmins() {
    UserTask issue = task("User_FixService", UserTaskState.CREATED);
    when(camunda.task(8L)).thenReturn(issue);

    assertThatThrownBy(() -> tasks.serviceAction(8L, "RETRY", user("dean@college.edu", "dean")))
        .isInstanceOf(ApiException.class);
    assertThatThrownBy(() -> tasks.openTasks(TaskService.Kind.SERVICE, null, user("dean@college.edu", "dean")))
        .isInstanceOf(ApiException.class);

    tasks.serviceAction(8L, "RETRY", user("admin@college.edu", "admin"));
    verify(camunda).completeTask(8L, Map.of("serviceFixAction", "RETRY", "resolvedBy", "admin@college.edu"));
  }

  @Test
  void requestersSeeTheirOwnBookingsApproversTheOnesSentToThemAdminsAll() {
    assertThat(BookingService.mayView(user("a@gmail.com"), "A@gmail.com", List.of("dean"))).isTrue();
    assertThat(BookingService.mayView(user("b@gmail.com"), "a@gmail.com", List.of("dean"))).isFalse();
    assertThat(BookingService.mayView(user("d@college.edu", "dean"), "a@gmail.com", List.of("hod", "dean"))).isTrue();
    assertThat(BookingService.mayView(user("h@college.edu", "hod"), "a@gmail.com", List.of("dean"))).isFalse();
    assertThat(BookingService.mayView(user("x@college.edu", "admin"), "a@gmail.com", List.of())).isTrue();
  }
}
