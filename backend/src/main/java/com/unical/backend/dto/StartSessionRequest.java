package com.unical.backend.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;

@Schema(description = "Request body to start a new browser session")
public record StartSessionRequest(
        @Schema(
                description = "University website URL. The AI will navigate from this page to the login form.",
                example = "https://www.university.edu",
                requiredMode = Schema.RequiredMode.REQUIRED
        )
        @NotBlank(message = "url must not be blank")
        String url
) {}
