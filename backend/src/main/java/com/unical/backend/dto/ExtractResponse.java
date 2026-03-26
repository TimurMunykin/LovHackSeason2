package com.unical.backend.dto;

import io.swagger.v3.oas.annotations.media.Schema;

import java.util.List;
import java.util.Map;

@Schema(description = "Extracted schedule entries from the provided HTML")
public record ExtractResponse(

        @Schema(
                description = """
                        List of schedule entries. Each entry is a JSON object whose keys are a \
                        subset of: `course_code`, `course_name`, `day`, `time_start`, `time_end`, \
                        `teacher`, `room`, `group`, `type`, `week_parity`, `semester`. \
                        Only keys present in the source HTML are included.
                        """,
                example = """
                        [
                          {
                            "course_code": "CS101",
                            "course_name": "Introduction to Algorithms",
                            "day": "Monday",
                            "time_start": "09:15",
                            "time_end": "10:45",
                            "teacher": "Smith J.",
                            "room": "A-101",
                            "type": "lecture",
                            "week_parity": null,
                            "semester": "Spring 2025"
                          }
                        ]
                        """
        )
        List<Map<String, Object>> entries
) {}
