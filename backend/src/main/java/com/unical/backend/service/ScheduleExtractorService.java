package com.unical.backend.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.microsoft.playwright.Page;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.*;
import java.util.function.Consumer;

/**
 * Extracts schedule entries from an already-navigated Playwright page.
 *
 * <p>Strategy (in order of preference):
 * <ol>
 *   <li>Scan captured network responses for JSON that looks like schedule data
 *       (contains keys like "course", "subject", "lesson", "timetable", etc.).</li>
 *   <li>DOM extraction via {@code page.evaluate()} — tables, CSS-grid cells,
 *       and card-based layouts.</li>
 *   <li>Fall back to {@link HtmlExtractorService} (Jsoup + LLM) on the
 *       full page HTML.</li>
 * </ol>
 */
@Service
@Slf4j
@RequiredArgsConstructor
public class ScheduleExtractorService {

    private static final Set<String> SCHEDULE_KEYS = Set.of(
            "course", "subject", "lesson", "timetable", "schedule",
            "class", "lecture", "seminar", "lab", "event",
            "courseCode", "course_code", "subjectName", "subject_name",
            "timeStart", "time_start", "startTime", "start_time",
            "dayOfWeek", "day_of_week", "weekday"
    );

    private final HtmlExtractorService htmlExtractorService;
    private final ObjectMapper objectMapper;

    /**
     * Extract schedule entries from the current page.
     *
     * @param page             live Playwright page (already on schedule page)
     * @param networkResponses network JSON responses captured during navigation
     * @param logSink          consumer for progress messages
     * @return list of schedule entry maps
     */
    public List<Map<String, Object>> extract(
            Page page,
            List<Map<String, Object>> networkResponses,
            Consumer<String> logSink
    ) {
        // --- Strategy 1: network responses ---
        List<Map<String, Object>> fromNetwork = extractFromNetwork(networkResponses, logSink);
        if (!fromNetwork.isEmpty()) {
            logSink.accept("Extracted " + fromNetwork.size() + " entries from network responses.");
            return fromNetwork;
        }

        // --- Strategy 2: DOM extraction ---
        List<Map<String, Object>> fromDom = extractFromDom(page, logSink);
        if (!fromDom.isEmpty()) {
            logSink.accept("Extracted " + fromDom.size() + " entries from DOM.");
            return fromDom;
        }

        // --- Strategy 3: LLM fallback ---
        logSink.accept("DOM extraction yielded nothing; falling back to LLM extraction.");
        try {
            String html = (String) page.evaluate("() => document.documentElement.outerHTML");
            List<Map<String, Object>> fromLlm = htmlExtractorService.extractFromHtml(html, logSink);
            logSink.accept("LLM extraction returned " + fromLlm.size() + " entries.");
            return fromLlm;
        } catch (Exception e) {
            log.error("LLM fallback extraction failed", e);
            logSink.accept("LLM fallback failed: " + e.getMessage());
            return List.of();
        }
    }

    // -------------------------------------------------------------------------
    // Network response scanning
    // -------------------------------------------------------------------------

    private List<Map<String, Object>> extractFromNetwork(
            List<Map<String, Object>> responses,
            Consumer<String> logSink
    ) {
        List<Map<String, Object>> results = new ArrayList<>();

        for (Map<String, Object> resp : responses) {
            String body = String.valueOf(resp.getOrDefault("body", ""));
            if (body.isBlank()) continue;

            try {
                // Try array of objects
                if (body.strip().startsWith("[")) {
                    List<Map<String, Object>> arr = objectMapper.readValue(body,
                            new TypeReference<>() {});
                    for (Map<String, Object> item : arr) {
                        if (looksLikeScheduleEntry(item)) {
                            results.add(normalizeNetworkEntry(item));
                        }
                    }
                } else if (body.strip().startsWith("{")) {
                    // Try nested: look for any array-valued field that contains schedule objects
                    Map<String, Object> obj = objectMapper.readValue(body,
                            new TypeReference<>() {});
                    for (Object val : obj.values()) {
                        if (val instanceof List<?> list) {
                            for (Object item : list) {
                                if (item instanceof Map<?, ?> map) {
                                    @SuppressWarnings("unchecked")
                                    Map<String, Object> entry = (Map<String, Object>) map;
                                    if (looksLikeScheduleEntry(entry)) {
                                        results.add(normalizeNetworkEntry(entry));
                                    }
                                }
                            }
                        }
                    }
                }
            } catch (Exception ignored) {
                // Not JSON or not parseable — skip
            }
        }

        return dedup(results);
    }

    private boolean looksLikeScheduleEntry(Map<String, Object> map) {
        long hits = map.keySet().stream()
                .filter(k -> SCHEDULE_KEYS.stream().anyMatch(sk ->
                        k.toLowerCase().contains(sk.toLowerCase())))
                .count();
        return hits >= 2;
    }

    /**
     * Normalize network API keys to our canonical schema where possible.
     */
    private Map<String, Object> normalizeNetworkEntry(Map<String, Object> raw) {
        Map<String, Object> entry = new LinkedHashMap<>();
        raw.forEach((k, v) -> {
            String lk = k.toLowerCase();
            if (lk.contains("code") && lk.contains("course")) {
                entry.put("course_code", v);
            } else if (lk.contains("name") || lk.contains("subject") || lk.contains("course")) {
                entry.putIfAbsent("course_name", v);
            } else if (lk.contains("day") || lk.contains("weekday")) {
                entry.put("day", v);
            } else if (lk.contains("start")) {
                entry.put("time_start", v);
            } else if (lk.contains("end") || lk.contains("finish")) {
                entry.put("time_end", v);
            } else if (lk.contains("room") || lk.contains("location") || lk.contains("place")) {
                entry.put("room", v);
            } else if (lk.contains("teacher") || lk.contains("lecturer") || lk.contains("instructor")) {
                entry.put("teacher", v);
            } else if (lk.contains("type") || lk.contains("kind")) {
                entry.put("type", v);
            } else if (lk.contains("group") || lk.contains("parallel") || lk.contains("section")) {
                entry.put("group", v);
            } else {
                entry.put(k, v);
            }
        });
        return entry;
    }

    // -------------------------------------------------------------------------
    // DOM extraction via page.evaluate()
    // -------------------------------------------------------------------------

    /**
     * JavaScript injected into the page to extract schedule entries from tables
     * and card-based grid layouts.
     */
    private static final String DOM_EXTRACT_SCRIPT = """
            () => {
              const entries = [];

              // --- HTML tables ---
              const tables = document.querySelectorAll('table');
              for (const table of tables) {
                const headers = [];
                const headerRow = table.querySelector('thead tr, tr:first-child');
                if (headerRow) {
                  for (const th of headerRow.querySelectorAll('th, td')) {
                    headers.push(th.innerText.trim().toLowerCase());
                  }
                }
                const timeIdx    = headers.findIndex(h => h.includes('time') || h.includes('hour') || h.includes('čas'));
                const courseIdx  = headers.findIndex(h => h.includes('course') || h.includes('subject') || h.includes('předmět') || h.includes('lekcia'));
                const dayIdx     = headers.findIndex(h => h.includes('day') || h.includes('den') || h.includes('deň'));
                const roomIdx    = headers.findIndex(h => h.includes('room') || h.includes('místnost') || h.includes('učebňa'));
                const teacherIdx = headers.findIndex(h => h.includes('teacher') || h.includes('lecturer') || h.includes('vyučující'));

                // Collect day names from column headers for rotated-header tables
                const colDays = [];
                if (headerRow) {
                  const ths = Array.from(headerRow.querySelectorAll('th, td'));
                  for (let i = 1; i < ths.length; i++) {
                    const t = ths[i].innerText.trim();
                    if (/mon|tue|wed|thu|fri|sat|sun|po|út|st|čt|pá|so|ne|pon|utr|str|štv|pia/i.test(t)) {
                      colDays[i] = t;
                    }
                  }
                }

                const rows = table.querySelectorAll('tbody tr, tr:not(:first-child)');
                for (const row of rows) {
                  const cells = row.querySelectorAll('td, th');
                  if (cells.length < 2) continue;

                  // Standard row-per-course table
                  if (courseIdx >= 0 || timeIdx >= 0) {
                    const entry = {};
                    if (courseIdx >= 0 && cells[courseIdx]) entry.course_name = cells[courseIdx].innerText.trim();
                    if (timeIdx >= 0    && cells[timeIdx])   entry.time_raw   = cells[timeIdx].innerText.trim();
                    if (dayIdx >= 0     && cells[dayIdx])    entry.day        = cells[dayIdx].innerText.trim();
                    if (roomIdx >= 0    && cells[roomIdx])   entry.room       = cells[roomIdx].innerText.trim();
                    if (teacherIdx >= 0 && cells[teacherIdx]) entry.teacher   = cells[teacherIdx].innerText.trim();
                    if (Object.keys(entry).length >= 2) entries.push(entry);
                    continue;
                  }

                  // Rotated: first cell is time slot, remaining cells are day columns
                  if (colDays.some(Boolean)) {
                    const timeText = cells[0] ? cells[0].innerText.trim() : '';
                    for (let ci = 1; ci < cells.length; ci++) {
                      const day = colDays[ci];
                      const text = cells[ci].innerText.trim();
                      if (day && text) {
                        entries.push({ day, time_raw: timeText, course_name: text });
                      }
                    }
                  }
                }
              }

              // --- CSS grid / card-based layouts ---
              const cards = document.querySelectorAll(
                '[class*="event"], [class*="lesson"], [class*="course"], ' +
                '[class*="schedule"], [class*="timetable"], [class*="cell"], ' +
                '[class*="block"], [class*="slot"], [class*="entry"]'
              );
              for (const card of cards) {
                const text = card.innerText.trim();
                if (!text || text.length < 4) continue;
                const timeMatch = text.match(/\\b(\\d{1,2}[:.h]\\d{2})(?:\\s*[-–]\\s*(\\d{1,2}[:.h]\\d{2}))?\\b/);
                const entry = { course_name: text };
                if (timeMatch) {
                  entry.time_start = timeMatch[1];
                  if (timeMatch[2]) entry.time_end = timeMatch[2];
                }
                const parent = card.closest('[data-day], [class*="day"], [class*="col"]');
                if (parent) {
                  entry.day = parent.getAttribute('data-day') ||
                              parent.getAttribute('aria-label') ||
                              parent.className.match(/(?:day|col)-?([a-z]+)/i)?.[1] || '';
                }
                entries.push(entry);
              }

              return entries;
            }
            """;

    private List<Map<String, Object>> extractFromDom(Page page, Consumer<String> logSink) {
        try {
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> raw = (List<Map<String, Object>>) page.evaluate(DOM_EXTRACT_SCRIPT);
            if (raw == null) return List.of();

            List<Map<String, Object>> processed = raw.stream()
                    .filter(e -> !e.isEmpty())
                    .map(this::processDomEntry)
                    .toList();

            return dedup(processed);
        } catch (Exception e) {
            log.warn("DOM extraction via page.evaluate() failed: {}", e.getMessage());
            return List.of();
        }
    }

    /**
     * Parse and normalize a raw DOM entry — splits time_raw into time_start/time_end.
     */
    private Map<String, Object> processDomEntry(Map<String, Object> raw) {
        Map<String, Object> entry = new LinkedHashMap<>(raw);
        String timeRaw = (String) entry.remove("time_raw");
        if (timeRaw != null) {
            // Try to parse "HH:MM - HH:MM" or "HH:MM"
            var m = java.util.regex.Pattern
                    .compile("(\\d{1,2}[:.h]\\d{2})(?:\\s*[-–]\\s*(\\d{1,2}[:.h]\\d{2}))?")
                    .matcher(timeRaw);
            if (m.find()) {
                entry.put("time_start", normalizeTime(m.group(1)));
                if (m.group(2) != null) entry.put("time_end", normalizeTime(m.group(2)));
            }
        }
        return entry;
    }

    private String normalizeTime(String t) {
        if (t == null) return null;
        return t.replace('h', ':').replace('.', ':');
    }

    // -------------------------------------------------------------------------
    // Deduplication
    // -------------------------------------------------------------------------

    private List<Map<String, Object>> dedup(List<Map<String, Object>> entries) {
        Set<String> seen = new LinkedHashSet<>();
        List<Map<String, Object>> out = new ArrayList<>();
        for (Map<String, Object> e : entries) {
            String key = String.join("|",
                    str(e, "course_code"), str(e, "course_name"),
                    str(e, "day"), str(e, "time_start"),
                    str(e, "group"), str(e, "room")
            ).toLowerCase();
            if (seen.add(key)) out.add(e);
        }
        return out;
    }

    private String str(Map<String, Object> m, String key) {
        Object v = m.get(key);
        return v == null ? "" : v.toString();
    }
}
