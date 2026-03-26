package com.unical.backend.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;

@Schema(description = "Request body for stateless HTML schedule extraction")
public record ExtractRequest(

        @Schema(
                description = "Raw HTML of a university schedule page. Scripts, styles, and framework attributes are stripped automatically before sending to the LLM.",
                example = "<html><body><table><tr><th>Day</th><th>Time</th><th>Subject</th></tr><tr><td>Monday</td><td>09:15</td><td>Introduction to Algorithms</td></tr></table></body></html>",
                requiredMode = Schema.RequiredMode.REQUIRED
        )
        @NotBlank(message = "html must not be blank")
        String html
) {}
