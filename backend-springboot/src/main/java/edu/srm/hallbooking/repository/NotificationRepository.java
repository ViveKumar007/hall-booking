package edu.srm.hallbooking.repository;

import edu.srm.hallbooking.domain.Notification;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface NotificationRepository extends JpaRepository<Notification, Long> {

  List<Notification> findAllByOrderByIdDesc();
}
