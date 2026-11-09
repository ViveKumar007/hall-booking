package edu.srm.hallbooking.repository;

import edu.srm.hallbooking.domain.RegisterSlot;
import java.time.LocalDate;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface RegisterSlotRepository extends JpaRepository<RegisterSlot, Long> {

  List<RegisterSlot> findByHallAndDayOrderByStartHourAsc(String hall, LocalDate day);

  List<RegisterSlot> findByHallOrderByDayAscStartHourAsc(String hall);

  List<RegisterSlot> findByDayOrderByStartHourAsc(LocalDate day);

  List<RegisterSlot> findByDayBetweenOrderByDayAscStartHourAsc(LocalDate from, LocalDate to);

  List<RegisterSlot> findAllByOrderByDayAscStartHourAsc();
}
