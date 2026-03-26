package com.unical.backend.dto;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.unical.backend.model.Session;
import com.unical.backend.model.SessionStatus;
import io.swagger.v3.oas.annotations.media.Schema;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Schema(description = "Current state of a browser session")
public record SessionResponse(

        @Schema(description = "Unique session identifier", example = "3fa85f64-5717-4562-b3fc-2c963f66afa6")
        UUID sessionId,

        @Schema(
                description = """
                        Lifecycle status:
                        - `STARTING` — browser is launching
                        - `NAVIGATING_LOGIN` — AI is looking for the login page
                        - `ACTIVE` — login page found, waiting for the user to log in
                        - `NAVIGATING_SCHEDULE` — AI is navigating to the schedule page
                        - `EXTRACTING` — pulling structured data from the schedule page
                        - `SUCCESS` — done; `result` contains schedule entries
                        - `FAILED` — something went wrong; see `errorMessage`
                        - `IDLE` — session was stopped
                        """
        )
        SessionStatus status,

        @Schema(description = "The initial URL the session was started with", example = "https://www.university.edu")
        String url,

        @Schema(description = "The URL currently loaded in the browser", example = "https://sso.university.edu/login")
        String currentUrl,

        @Schema(description = "Title of the page currently loaded in the browser", example = "Login — University SSO")
        String currentTitle,

        @Schema(description = "Step-by-step log of AI navigation actions. Each entry has `phase` and `message` keys.")
        List<Map<String, Object>> aiLog,

        @Schema(description = "Extraction result entries (populated when status is SUCCESS). Each entry may have fields: course_code, course_name, day, time_start, time_end, teacher, room, group, type, week_parity, semester.")
        List<Map<String, Object>> result,

        @Schema(description = "Human-readable error message when status is FAILED", nullable = true)
        String errorMessage,

        @Schema(description = "noVNC viewer URL. Open this in a browser to watch and interact with the running Playwright browser.", example = "http://localhost:6080/vnc_lite.html?autoconnect=true&resize=scale")
        String vncUrl,

        @Schema(description = "When the session was created")
        Instant createdAt,

        @Schema(description = "When the session was last updated")
        Instant updatedAt,

        @Schema(description = "When the session will automatically expire (30 minutes after last activity)")
        Instant expiresAt
) {
    private static final ObjectMapper MAPPER = new ObjectMapper();

    public static SessionResponse from(Session session, String backendHost) {
        List<Map<String, Object>> aiLog = parseJson(session.getAiLog());
        List<Map<String, Object>> result = parseJson(session.getResult());
        String vncUrl = String.format(
                "http://%s:6080/vnc_lite.html?autoconnect=true&resize=scale", backendHost);

        return new SessionResponse(
                session.getId(),
                session.getStatus(),
                session.getUrl(),
                session.getCurrentUrl(),
                session.getCurrentTitle(),
                aiLog,
                result,
                session.getErrorMessage(),
                vncUrl,
                session.getCreatedAt(),
                session.getUpdatedAt(),
                session.getExpiresAt()
        );
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> parseJson(String json) {
        if (json == null || json.isBlank()) return List.of();
        try {
            return MAPPER.readValue(json, new TypeReference<>() {});
        } catch (Exception e) {
            return List.of();
        }
    }
}
