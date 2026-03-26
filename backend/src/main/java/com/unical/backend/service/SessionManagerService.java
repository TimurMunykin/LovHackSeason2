package com.unical.backend.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.microsoft.playwright.*;
import com.unical.backend.model.Session;
import com.unical.backend.model.SessionStatus;
import com.unical.backend.repository.SessionRepository;
import jakarta.annotation.PreDestroy;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.core.task.TaskExecutor;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.time.Instant;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Single source of truth for session lifecycle.
 *
 * <p>Live Playwright objects (Browser, BrowserContext, Page) live in an
 * in-memory {@link ConcurrentHashMap}. Serializable state is mirrored to
 * PostgreSQL on every status change so the DB is always consistent.
 *
 * <p>Background tasks are submitted to a {@link TaskExecutor} rather than
 * using {@code @Async} self-invocation, which would be bypassed by the proxy.
 */
@Service
@Slf4j
@RequiredArgsConstructor
public class SessionManagerService {

    /** Holds live Playwright objects for each session. */
    public record BrowserSession(
            Playwright playwright,
            Browser browser,
            BrowserContext context,
            Page page,
            List<Map<String, Object>> networkResponses
    ) {}

    private final SessionRepository sessionRepository;
    private final AiNavigatorService aiNavigatorService;
    private final ScheduleExtractorService scheduleExtractorService;
    private final ObjectMapper objectMapper;
    private final TaskExecutor taskExecutor;

    /** In-memory map: sessionId → live browser objects. */
    private final ConcurrentHashMap<UUID, BrowserSession> liveSessions = new ConcurrentHashMap<>();

    // -------------------------------------------------------------------------
    // Public API
    // -------------------------------------------------------------------------

    /**
     * Create a new session, persist it to DB, launch the Playwright browser,
     * and kick off the async login-navigation loop.
     *
     * <p>The save is allowed to commit before the background task starts so
     * the task can find the session in the DB via its ID.
     */
    @Transactional
    public Session createSession(String url) {
        Session session = new Session();
        session.setStatus(SessionStatus.NAVIGATING_LOGIN);
        session.setUrl(url);
        session.setAiLog(emptyJsonArray());
        session = sessionRepository.saveAndFlush(session);

        final UUID sessionId = session.getId();
        // Ensure the task starts only after this transaction commits so the
        // background thread can read the session row from the DB.
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override
            public void afterCommit() {
                taskExecutor.execute(() -> startLoginNavigation(sessionId, url));
            }
        });
        return session;
    }

    /**
     * Return a snapshot of the session state, merging live browser page info.
     */
    @Transactional(readOnly = true)
    public Optional<Session> getSession(UUID id) {
        return sessionRepository.findById(id).map(session -> {
            BrowserSession live = liveSessions.get(id);
            if (live != null) {
                try {
                    session.setCurrentUrl(live.page().url());
                    session.setCurrentTitle(live.page().title());
                } catch (Exception ignored) {
                    // Page may already be closed
                }
            }
            return session;
        });
    }

    /**
     * Called when the user signals they have finished logging in.
     * Transitions status to NAVIGATING_SCHEDULE and starts async extraction.
     */
    @Transactional
    public Optional<Session> confirmLogin(UUID id) {
        return sessionRepository.findById(id).map(session -> {
            if (session.getStatus() != SessionStatus.ACTIVE) {
                throw new IllegalStateException(
                        "Session is not in ACTIVE state; current: " + session.getStatus());
            }
            updateStatus(session, SessionStatus.NAVIGATING_SCHEDULE);
            sessionRepository.saveAndFlush(session);
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    taskExecutor.execute(() -> startScheduleExtraction(id));
                }
            });
            return session;
        });
    }

    /**
     * Stop the browser and delete the session from DB and in-memory map.
     */
    @Transactional
    public boolean deleteSession(UUID id) {
        if (!sessionRepository.existsById(id)) {
            return false;
        }
        closeLiveSession(id);
        sessionRepository.deleteById(id);
        return true;
    }

    // -------------------------------------------------------------------------
    // Async navigation tasks
    // -------------------------------------------------------------------------

    public void startLoginNavigation(UUID sessionId, String url) {
        try {
            Playwright playwright = Playwright.create();
            Browser browser = playwright.chromium().launch(
                    new BrowserType.LaunchOptions()
                            .setHeadless(false)        // Xvfb provides the display
                            .setArgs(List.of(
                                    "--no-sandbox",
                                    "--disable-setuid-sandbox",
                                    "--disable-dev-shm-usage"
                            ))
            );
            BrowserContext context = browser.newContext();
            Page page = context.newPage();

            List<Map<String, Object>> networkResponses = Collections.synchronizedList(new ArrayList<>());
            page.onResponse(response -> {
                String contentType = response.headers().getOrDefault("content-type", "");
                if (contentType.contains("application/json")) {
                    try {
                        String body = response.text();
                        networkResponses.add(Map.of(
                                "url", response.url(),
                                "status", response.status(),
                                "body", body
                        ));
                    } catch (Exception ignored) {}
                }
            });

            liveSessions.put(sessionId, new BrowserSession(playwright, browser, context, page, networkResponses));

            page.navigate(url);
            page.waitForLoadState();

            appendLog(sessionId, "info", "Browser launched, navigated to " + url);

            boolean found = aiNavigatorService.navigateToGoal(
                    sessionId, page, AiNavigatorService.Goal.LOGIN,
                    logMsg -> appendLog(sessionId, "info", logMsg)
            );

            if (found) {
                updateStatusInDb(sessionId, SessionStatus.ACTIVE, null);
                appendLog(sessionId, "info", "Login page reached — waiting for user to log in.");
            } else {
                updateStatusInDb(sessionId, SessionStatus.FAILED, "AI could not locate the login page.");
                appendLog(sessionId, "warn", "Login navigation failed.");
                closeLiveSession(sessionId);
            }

        } catch (Exception e) {
            log.error("Login navigation error for session {}", sessionId, e);
            updateStatusInDb(sessionId, SessionStatus.FAILED, e.getMessage());
            closeLiveSession(sessionId);
        }
    }

    public void startScheduleExtraction(UUID sessionId) {
        try {
            BrowserSession live = liveSessions.get(sessionId);
            if (live == null) {
                updateStatusInDb(sessionId, SessionStatus.FAILED, "No live browser session found.");
                return;
            }

            appendLog(sessionId, "info", "Starting schedule navigation.");
            boolean found = aiNavigatorService.navigateToGoal(
                    sessionId, live.page(), AiNavigatorService.Goal.SCHEDULE,
                    logMsg -> appendLog(sessionId, "info", logMsg)
            );

            if (!found) {
                updateStatusInDb(sessionId, SessionStatus.FAILED, "AI could not locate the schedule page.");
                closeLiveSession(sessionId);
                return;
            }

            updateStatusInDb(sessionId, SessionStatus.EXTRACTING, null);
            appendLog(sessionId, "info", "Schedule page found. Extracting…");

            List<Map<String, Object>> entries = scheduleExtractorService.extract(
                    live.page(), live.networkResponses(),
                    logMsg -> appendLog(sessionId, "info", logMsg)
            );

            String resultJson = objectMapper.writeValueAsString(entries);
            updateResultInDb(sessionId, resultJson);
            updateStatusInDb(sessionId, SessionStatus.SUCCESS, null);
            appendLog(sessionId, "info", "Extraction complete. " + entries.size() + " entries found.");

        } catch (Exception e) {
            log.error("Schedule extraction error for session {}", sessionId, e);
            updateStatusInDb(sessionId, SessionStatus.FAILED, e.getMessage());
        } finally {
            closeLiveSession(sessionId);
        }
    }

    // -------------------------------------------------------------------------
    // Expiry cleanup
    // -------------------------------------------------------------------------

    @Scheduled(fixedDelay = 5 * 60 * 1000)   // every 5 minutes
    @Transactional
    public void cleanupExpiredSessions() {
        List<Session> expired = sessionRepository.findExpired(Instant.now());
        for (Session s : expired) {
            log.info("Cleaning up expired session {}", s.getId());
            closeLiveSession(s.getId());
        }
        if (!expired.isEmpty()) {
            int deleted = sessionRepository.deleteExpired(Instant.now());
            log.info("Deleted {} expired sessions from DB.", deleted);
        }
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    @Transactional
    public void updateStatusInDb(UUID sessionId, SessionStatus status, String errorMessage) {
        sessionRepository.findById(sessionId).ifPresent(session -> {
            updateStatus(session, status);
            if (errorMessage != null) {
                session.setErrorMessage(errorMessage);
            }
            sessionRepository.save(session);
        });
    }

    @Transactional
    public void updateResultInDb(UUID sessionId, String resultJson) {
        sessionRepository.findById(sessionId).ifPresent(session -> {
            session.setResult(resultJson);
            sessionRepository.save(session);
        });
    }

    private void updateStatus(Session session, SessionStatus status) {
        log.info("Session {} → {}", session.getId(), status);
        session.setStatus(status);
    }

    @Transactional
    public void appendLog(UUID sessionId, String level, String message) {
        sessionRepository.findById(sessionId).ifPresent(session -> {
            try {
                String existing = session.getAiLog() != null ? session.getAiLog() : "[]";
                @SuppressWarnings("unchecked")
                List<Map<String, Object>> logs = objectMapper.readValue(existing, List.class);
                logs.add(Map.of(
                        "level", level,
                        "message", message,
                        "timestamp", Instant.now().toString()
                ));
                session.setAiLog(objectMapper.writeValueAsString(logs));
                sessionRepository.save(session);
            } catch (JsonProcessingException e) {
                log.warn("Failed to append log for session {}", sessionId, e);
            }
        });
    }

    private void closeLiveSession(UUID sessionId) {
        BrowserSession live = liveSessions.remove(sessionId);
        if (live != null) {
            try { live.context().close(); } catch (Exception ignored) {}
            try { live.browser().close(); } catch (Exception ignored) {}
            try { live.playwright().close(); } catch (Exception ignored) {}
        }
    }

    private String emptyJsonArray() {
        return "[]";
    }

    @PreDestroy
    public void onShutdown() {
        log.info("Shutting down {} live sessions.", liveSessions.size());
        new HashSet<>(liveSessions.keySet()).forEach(this::closeLiveSession);
    }
}
