package com.unical.backend.controller;

import com.unical.backend.dto.ExtractRequest;
import com.unical.backend.dto.ExtractResponse;
import com.unical.backend.service.HtmlExtractorService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

@Tag(name = "Extraction", description = "Stateless LLM-based schedule extraction from raw HTML")
@RestController
@Slf4j
@RequiredArgsConstructor
public class ExtractController {

    private final HtmlExtractorService htmlExtractorService;

    @Operation(
            summary = "Extract schedule from HTML",
            description = """
                    Accepts the raw HTML of a university schedule page and returns structured \
                    schedule entries extracted by an LLM.

                    **Processing pipeline:**
                    1. Strip all `<style>`, `<script>`, `<svg>` and framework-generated attributes
                    2. Trim the HTML to the schedule section (first detected time/day signal)
                    3. Split into token-budget chunks
                    4. Send each chunk to the LLM with a structured extraction prompt
                    5. Deduplicate and merge results across chunks

                    Each entry in `entries` may contain fields such as `course_code`, `course_name`, \
                    `day`, `time_start`, `time_end`, `teacher`, `room`, `group`, `type`, \
                    `week_parity`, and `semester`. Only fields present in the source HTML are included.

                    This endpoint is **stateless** — no browser or session is needed.
                    """
    )
    @ApiResponses({
            @ApiResponse(responseCode = "200", description = "Extraction successful (may return empty list if no schedule found)",
                    content = @Content(mediaType = MediaType.APPLICATION_JSON_VALUE,
                            schema = @Schema(implementation = ExtractResponse.class))),
            @ApiResponse(responseCode = "400", description = "Missing or blank `html` field",
                    content = @Content(mediaType = MediaType.APPLICATION_JSON_VALUE))
    })
    @PostMapping("/extract")
    public ResponseEntity<ExtractResponse> extract(
            @Valid @RequestBody ExtractRequest request) {
        List<String> logs = new ArrayList<>();
        List<Map<String, Object>> entries = htmlExtractorService.extractFromHtml(
                request.html(),
                msg -> {
                    log.info("[extract] {}", msg);
                    logs.add(msg);
                }
        );
        return ResponseEntity.ok(new ExtractResponse(entries));
    }
}
