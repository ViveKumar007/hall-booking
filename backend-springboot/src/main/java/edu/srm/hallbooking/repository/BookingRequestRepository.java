package edu.srm.hallbooking.repository;

import edu.srm.hallbooking.domain.BookingRequest;
import java.util.List;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

public interface BookingRequestRepository extends JpaRepository<BookingRequest, Long> {

  List<BookingRequest> findAllByOrderByCreatedAtDesc(Pageable page);

  List<BookingRequest> findByEmailIgnoreCaseOrderByCreatedAtDesc(String email, Pageable page);
}
