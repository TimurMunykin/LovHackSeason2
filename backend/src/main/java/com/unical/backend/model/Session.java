package com.unical.backend.model;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "sessions")
@Getter
@Setter
public class Session {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 32)
    private SessionStatus status;

    @Column(nullable = false)
    private String url;

    private String currentUrl;
    private String currentTitle;

    /** JSON array of log message objects: [{level, message, timestamp}] */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "jsonb")
    private String aiLog;

    /** JSON array of extracted schedule entries. */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "jsonb")
    private String result;

    /** Error message when status = FAILED. */
    @Column(length = 2048)
    private String errorMessage;

    @Column(nullable = false, updatable = false)
    private Instant createdAt;

    @Column(nullable = false)
    private Instant updatedAt;

    @Column(nullable = false)
    private Instant expiresAt;

    @PrePersist
    protected void onCreate() {
        createdAt = Instant.now();
        updatedAt = Instant.now();
        expiresAt = Instant.now().plusSeconds(30 * 60);
    }

    @PreUpdate
    protected void onUpdate() {
        updatedAt = Instant.now();
    }
}
