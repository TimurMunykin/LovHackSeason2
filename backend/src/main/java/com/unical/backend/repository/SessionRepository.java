package com.unical.backend.repository;

import com.unical.backend.model.Session;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Repository;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

@Repository
public interface SessionRepository extends JpaRepository<Session, UUID> {

    @Query("SELECT s FROM Session s WHERE s.expiresAt < :now")
    List<Session> findExpired(Instant now);

    @Modifying
    @Query("DELETE FROM Session s WHERE s.expiresAt < :now")
    int deleteExpired(Instant now);
}
