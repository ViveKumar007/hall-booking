package edu.srm.hallbooking.repository;

import edu.srm.hallbooking.domain.AppUser;
import org.springframework.data.jpa.repository.JpaRepository;

public interface AppUserRepository extends JpaRepository<AppUser, String> {}
