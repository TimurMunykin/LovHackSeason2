package com.unical.backend.controller;

import com.unical.backend.dto.SessionResponse;
import com.unical.backend.dto.StartSessionRequest;
import com.unical.backend.model.Session;
import com.unical.backend.service.SessionManagerService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;
import java.util.UUID;

@Tag(name = "Sessions", description = "Browser automation sessions: AI-guided login navigation + schedule extraction")
@RestController
@RequestMapping("/sessions")
@RequiredArgsConstructor
public class SessionController {

    private final SessionManagerService sessionManagerService;

    @Value("${BACKEND_HOST:localhost}")
    private String backendHost;

    @Operation(
            summary = "Start a new browser session",
            description = """
                    Launches a Playwright Chromium browser, navigates to the provided URL, \
                    and uses GPT vision to find the login page (up to 12 navigation steps).

                    **Session flow after this call:**
                    1. Poll `GET /sessions/{id}` until `status` is `active`
                    2. Open the `vncUrl` from the response to watch/interact with the browser
                    3. Complete login manually in the VNC viewer
                    4. Call `POST /sessions/{id}/confirm` to hand back to the AI
                    """
    )
    @ApiResponses({
            @ApiResponse(responseCode = "201", description = "Session created and browser starting",
                    content = @Content(mediaType = MediaType.APPLICATION_JSON_VALUE,
                            schema = @Schema(implementation = SessionResponse.class))),
            @ApiResponse(responseCode = "400", description = "Missing or invalid `url`",
                    content = @Content(mediaType = MediaType.APPLICATION_JSON_VALUE))
    })
    @PostMapping
    public ResponseEntity<SessionResponse> createSession(
            @Valid @RequestBody StartSessionRequest request) {
        Session session = sessionManagerService.createSession(request.url());
        return ResponseEntity
                .status(HttpStatus.CREATED)
                .body(SessionResponse.from(session, backendHost));
    }

    @Operation(
            summary = "Poll session status",
            description = """
                    Returns the current state of a session. Poll this endpoint every 1–2 seconds \
                    to track AI navigation progress, read the `aiLog` for step-by-step messages, \
                    and detect when extraction is complete (`status: success`).

                    The `result` field is populated once `status` reaches `success`.
                    """
    )
    @ApiResponses({
            @ApiResponse(responseCode = "200", description = "Session found",
                    content = @Content(mediaType = MediaType.APPLICATION_JSON_VALUE,
                            schema = @Schema(implementation = SessionResponse.class))),
            @ApiResponse(responseCode = "404", description = "Session not found")
    })
    @GetMapping("/{id}")
    public ResponseEntity<SessionResponse> getSession(
            @Parameter(description = "Session UUID returned by POST /sessions", required = true)
            @PathVariable UUID id) {
        return sessionManagerService.getSession(id)
                .map(s -> ResponseEntity.ok(SessionResponse.from(s, backendHost)))
                .orElse(ResponseEntity.notFound().build());
    }

    @Operation(
            summary = "Confirm login completed",
            description = """
                    Call this after you have finished logging in through the VNC viewer. \
                    The AI will then navigate to the schedule page and extract the data.

                    Only valid when `status` is `active`. Returns `400` if called in any other state.
                    """
    )
    @ApiResponses({
            @ApiResponse(responseCode = "200", description = "Confirmed — AI now navigating to schedule page",
                    content = @Content(mediaType = MediaType.APPLICATION_JSON_VALUE,
                            schema = @Schema(implementation = SessionResponse.class))),
            @ApiResponse(responseCode = "400", description = "Session is not in `active` state",
                    content = @Content(mediaType = MediaType.APPLICATION_JSON_VALUE)),
            @ApiResponse(responseCode = "404", description = "Session not found")
    })
    @PostMapping("/{id}/confirm")
    public ResponseEntity<?> confirmLogin(
            @Parameter(description = "Session UUID", required = true)
            @PathVariable UUID id) {
        try {
            return sessionManagerService.confirmLogin(id)
                    .map(s -> ResponseEntity.ok(SessionResponse.from(s, backendHost)))
                    .orElse(ResponseEntity.notFound().build());
        } catch (IllegalStateException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    @Operation(
            summary = "Stop and delete a session",
            description = "Closes the browser, cancels any in-progress AI navigation, and removes the session record."
    )
    @ApiResponses({
            @ApiResponse(responseCode = "204", description = "Session deleted"),
            @ApiResponse(responseCode = "404", description = "Session not found")
    })
    @DeleteMapping("/{id}")
    public ResponseEntity<Void> deleteSession(
            @Parameter(description = "Session UUID", required = true)
            @PathVariable UUID id) {
        boolean deleted = sessionManagerService.deleteSession(id);
        return deleted
                ? ResponseEntity.noContent().build()
                : ResponseEntity.notFound().build();
    }
}
