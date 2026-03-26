package com.unical.backend.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.openai.client.OpenAIClient;
import com.openai.models.ChatModel;
import com.openai.models.chat.completions.*;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;
import org.jsoup.select.Elements;
import org.springframework.stereotype.Service;

import java.util.*;
import java.util.function.Consumer;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Java port of {@code extract_schedule.py}.
 *
 * <p>Pipeline:
 * <ol>
 *   <li>Minimize HTML with Jsoup (strip {@code <script>}, {@code <style>}, SVG, etc.).</li>
 *   <li>Trim to the schedule section (drop page chrome before the first time/day signal).</li>
 *   <li>Split into token-budget chunks.</li>
 *   <li>Call GPT for each chunk, accumulate + deduplicate entries.</li>
 * </ol>
 */
@Service
@Slf4j
@RequiredArgsConstructor
public class HtmlExtractorService {

    private static final String MODEL = "gpt-4o-mini";
    private static final int CHUNK_CHAR_BUDGET = 80_000;   // ≈ 20K tokens at 4 chars/tok
    private static final double CHARS_PER_TOKEN = 4.0;
    private static final int MAX_RETRIES = 4;
    private static final int SCHEDULE_CONTEXT_BEFORE = 2000;

    private final OpenAIClient openAIClient;
    private final ObjectMapper objectMapper;

    // -------------------------------------------------------------------------
    // Attribute noise lists (mirrors Python extract_schedule.py)
    // -------------------------------------------------------------------------

    private static final Set<String> NOISE_ATTRS = Set.of(
            "tabindex", "focusable", "xmlns", "viewBox",
            "onclick", "onmouseenter", "onmouseleave", "onfocus", "onblur",
            "onkeydown", "onkeyup", "onkeypress", "oninput", "onchange",
            "crossorigin", "as", "rel", "integrity", "fetchpriority",
            "aria-label", "aria-labelledby", "aria-describedby",
            "aria-expanded", "aria-haspopup", "aria-controls",
            "aria-selected", "aria-checked", "aria-disabled"
    );

    private static final List<String> NOISE_ATTR_PREFIXES = List.of(
            "data-v-", "_nghost-", "_ngcontent-", "ng-", "data-ng-",
            "svelte-", "data-react", "data-ember", "x-bind:", "x-on:", "@", ":"
    );

    // -------------------------------------------------------------------------
    // System prompt (identical to Python version)
    // -------------------------------------------------------------------------

    private static final String SYSTEM_PROMPT = """
            You are extracting structured schedule data from the HTML of a university \
            timetable page. The page can be from ANY university and use ANY layout \
            (HTML table, CSS grid, list, calendar widget, etc.).

            The day of the week for each entry is often encoded STRUCTURALLY rather than \
            as visible text inside the entry — common patterns include:
              - CSS grid: style="grid-area: N / ..." where N is the row (correlate with
                day-header labels visible elsewhere on the page to learn the mapping).
              - HTML table: the entry's column position matches a <th> day header.
              - Parent container: the entry is inside a wrapper that carries the day name
                as a class, data attribute, or heading text.
              - data attribute: data-day="Monday" on the entry or a nearby element.
            Read the surrounding HTML carefully to determine the correct day for every entry.

            Extract EVERY schedule entry and return a JSON array. Each entry uses this \
            schema; omit fields that are genuinely absent from this page:
            {
              "course_code":  "string | null",
              "course_name":  "string | null",
              "day":          "string",
              "time_start":   "string",
              "time_end":     "string | null",
              "teacher":      "string | null",
              "room":         "string | null",
              "group":        "string | null",
              "type":         "string | null",
              "week_parity":  "string | null",
              "semester":     "string | null"
            }

            Rules:
            - Determine "day" from the HTML structure — never leave it null if determinable.
            - The SAME course CAN appear multiple times — output each occurrence as a SEPARATE entry.
            - Convert all times to 24 h "HH:MM" regardless of input format.
            - Output ONLY a valid JSON array [ {...}, ... ]. No markdown, no prose.
            - If no schedule entries are found in this chunk, output: []
            - Do NOT invent data that is not present in the HTML.
            """;

    // -------------------------------------------------------------------------
    // Public API
    // -------------------------------------------------------------------------

    /**
     * Extract schedule entries from raw HTML using the full pipeline.
     */
    public List<Map<String, Object>> extractFromHtml(String html, Consumer<String> logSink) {
        String minimized = minimizeHtml(html);
        String trimmed = trimToSchedule(minimized);
        logSink.accept(String.format("HTML minimized: %,d → %,d chars", html.length(), trimmed.length()));

        List<String> chunks = splitIntoChunks(trimmed, CHUNK_CHAR_BUDGET);
        logSink.accept("Splitting into " + chunks.size() + " chunk(s).");

        List<Map<String, Object>> allEntries = new ArrayList<>();

        for (int i = 0; i < chunks.size(); i++) {
            String chunk = chunks.get(i);
            logSink.accept(String.format("Chunk %d/%d: %,d chars", i + 1, chunks.size(), chunk.length()));
            String contextSummary = buildContextSummary(allEntries);
            List<Map<String, Object>> entries = processChunkWithRetry(chunk, contextSummary, CHUNK_CHAR_BUDGET, 0);
            logSink.accept("  → " + entries.size() + " entries extracted.");
            allEntries = mergeEntries(allEntries, entries);
        }

        return allEntries;
    }

    // -------------------------------------------------------------------------
    // HTML minimization (Jsoup)
    // -------------------------------------------------------------------------

    String minimizeHtml(String html) {
        Document doc = Jsoup.parse(html);

        // Remove noise tags entirely
        Elements noiseEls = doc.select("style, script, svg, noscript, link, meta, head");
        noiseEls.remove();

        // Strip noise attributes from every remaining element
        for (Element el : doc.getAllElements()) {
            List<String> toRemove = new ArrayList<>();
            for (org.jsoup.nodes.Attribute attr : el.attributes()) {
                String name = attr.getKey();
                if (NOISE_ATTRS.contains(name)) {
                    toRemove.add(name);
                } else if (NOISE_ATTR_PREFIXES.stream().anyMatch(name::startsWith)) {
                    toRemove.add(name);
                }
            }
            toRemove.forEach(el::removeAttr);
        }

        String result = doc.outerHtml();
        result = result.replaceAll("\\n{3,}", "\n\n").replaceAll("[ \\t]+", " ");
        return result.strip();
    }

    // -------------------------------------------------------------------------
    // Trim to schedule section
    // -------------------------------------------------------------------------

    private static final Pattern TIME_RANGE = Pattern.compile(
            "\\b\\d{1,2}[:.\\u202f]\\d{2}\\s*[-\u2013\u2014]\\s*\\d{1,2}[:.\\u202f]\\d{2}\\b");
    private static final Pattern TIME_TOKEN = Pattern.compile(
            "\\b\\d{1,2}[:.h]\\d{2}(?:\\s*[AaPp][Mm])?\\b");
    private static final Pattern DAY_NAME = Pattern.compile(
            "\\b(?:Mon(?:day)?|Tue(?:sday)?|Wed(?:nesday)?|Thu(?:rsday)?|" +
            "Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?)\\b", Pattern.CASE_INSENSITIVE);

    String trimToSchedule(String minimized) {
        int anchor = -1;
        Matcher m = TIME_RANGE.matcher(minimized);
        if (m.find()) {
            anchor = m.start();
        } else {
            m = TIME_TOKEN.matcher(minimized);
            if (m.find()) {
                anchor = m.start();
            } else {
                m = DAY_NAME.matcher(minimized);
                if (m.find()) anchor = m.start();
            }
        }
        if (anchor == -1) return minimized;
        return minimized.substring(Math.max(0, anchor - SCHEDULE_CONTEXT_BEFORE));
    }

    // -------------------------------------------------------------------------
    // Chunking
    // -------------------------------------------------------------------------

    List<String> splitIntoChunks(String text, int charBudget) {
        if (text.length() <= charBudget) return List.of(text);

        List<String> chunks = new ArrayList<>();
        splitRecursive(text, charBudget, new String[]{"\n\n", "\n", " "}, 0, chunks);
        return chunks;
    }

    private void splitRecursive(String text, int budget, String[] seps, int sepIdx, List<String> out) {
        if (text.length() <= budget) {
            if (!text.isBlank()) out.add(text.strip());
            return;
        }
        if (sepIdx >= seps.length) {
            // Hard split
            for (int i = 0; i < text.length(); i += budget) {
                String part = text.substring(i, Math.min(i + budget, text.length())).strip();
                if (!part.isBlank()) out.add(part);
            }
            return;
        }
        String sep = seps[sepIdx];
        String[] parts = text.split(Pattern.quote(sep), -1);
        StringBuilder current = new StringBuilder();
        for (String part : parts) {
            String candidate = current.length() == 0
                    ? part
                    : current + sep + part;
            if (candidate.length() <= budget) {
                current = new StringBuilder(candidate);
            } else {
                if (!current.toString().isBlank()) {
                    if (current.length() > budget) {
                        splitRecursive(current.toString(), budget, seps, sepIdx + 1, out);
                    } else {
                        out.add(current.toString().strip());
                    }
                }
                current = new StringBuilder(part);
            }
        }
        if (!current.toString().isBlank()) {
            if (current.length() > budget) {
                splitRecursive(current.toString(), budget, seps, sepIdx + 1, out);
            } else {
                out.add(current.toString().strip());
            }
        }
    }

    // -------------------------------------------------------------------------
    // LLM extraction
    // -------------------------------------------------------------------------

    private List<Map<String, Object>> processChunkWithRetry(
            String chunk, String contextSummary, int budget, int depth) {
        if (depth > MAX_RETRIES) {
            log.warn("Max retries reached for chunk of {} chars; skipping.", chunk.length());
            return List.of();
        }
        try {
            String raw = callLlm(chunk, contextSummary);
            return extractJsonArray(raw);
        } catch (Exception e) {
            String err = e.getMessage() != null ? e.getMessage().toLowerCase() : "";
            boolean tokenLimit = List.of("token", "limit", "context", "length", "too long")
                    .stream().anyMatch(err::contains);
            if (tokenLimit) {
                log.warn("Token limit hit — splitting chunk in half (depth={}).", depth);
                int half = chunk.length() / 2;
                int boundary = chunk.lastIndexOf(' ', half);
                if (boundary == -1) boundary = half;
                List<Map<String, Object>> left  = processChunkWithRetry(chunk.substring(0, boundary), contextSummary, budget / 2, depth + 1);
                List<Map<String, Object>> right = processChunkWithRetry(chunk.substring(boundary),     contextSummary, budget / 2, depth + 1);
                List<Map<String, Object>> merged = new ArrayList<>(left);
                merged.addAll(right);
                return merged;
            }
            log.error("LLM chunk extraction failed: {}", e.getMessage());
            return List.of();
        }
    }

    private String callLlm(String chunk, String contextSummary) {
        String userContent = chunk;
        if (contextSummary != null && !contextSummary.isBlank()) {
            userContent = "[Already extracted entries — skip ONLY exact duplicates " +
                    "(same course + day + time_start + group + room)]:\n" +
                    contextSummary + "\n\n" +
                    "[New HTML to process — extract ALL entries, including those for " +
                    "courses already seen above if they have a different " +
                    "day / time / group / room]:\n" + chunk;
        }

        ChatCompletionCreateParams params = ChatCompletionCreateParams.builder()
                .model(ChatModel.GPT_4O_MINI)
                .maxCompletionTokens(4096)
                .temperature(0.0)
                .messages(List.of(
                        ChatCompletionMessageParam.ofSystem(
                                ChatCompletionSystemMessageParam.builder()
                                        .content(SYSTEM_PROMPT)
                                        .build()
                        ),
                        ChatCompletionMessageParam.ofUser(
                                ChatCompletionUserMessageParam.builder()
                                        .content(userContent)
                                        .build()
                        )
                ))
                .build();

        ChatCompletion completion = openAIClient.chat().completions().create(params);
        return completion.choices().get(0).message().content().orElse("[]").strip();
    }

    // -------------------------------------------------------------------------
    // JSON parsing
    // -------------------------------------------------------------------------

    List<Map<String, Object>> extractJsonArray(String raw) {
        if (raw == null || raw.isBlank()) return List.of();
        // Strip markdown fences
        raw = raw.replaceAll("```(?:json)?\\s*", "").replaceAll("```\\s*$", "").strip();

        int start = raw.indexOf('[');
        if (start == -1) return List.of();

        int depth = 0, end = -1;
        for (int i = start; i < raw.length(); i++) {
            char c = raw.charAt(i);
            if (c == '[') depth++;
            else if (c == ']') { depth--; if (depth == 0) { end = i; break; } }
        }
        if (end == -1) return List.of();

        try {
            return objectMapper.readValue(raw.substring(start, end + 1), new TypeReference<>() {});
        } catch (Exception e) {
            log.warn("JSON parse failure in extractJsonArray: {}", e.getMessage());
            return List.of();
        }
    }

    // -------------------------------------------------------------------------
    // Deduplication / merge
    // -------------------------------------------------------------------------

    private List<Map<String, Object>> mergeEntries(
            List<Map<String, Object>> existing,
            List<Map<String, Object>> newEntries) {
        Set<String> seen = new LinkedHashSet<>();
        for (Map<String, Object> e : existing) seen.add(entryKey(e));

        List<Map<String, Object>> merged = new ArrayList<>(existing);
        for (Map<String, Object> e : newEntries) {
            if (seen.add(entryKey(e))) merged.add(e);
        }
        return merged;
    }

    private String entryKey(Map<String, Object> e) {
        return String.join("|",
                upperStr(e, "course_code"),
                upperStr(e, "course_name"),
                lowerStr(e, "day"),
                str(e, "time_start"),
                upperStr(e, "group"),
                upperStr(e, "room")
        );
    }

    private String buildContextSummary(List<Map<String, Object>> entries) {
        if (entries.isEmpty()) return "";
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < Math.min(100, entries.size()); i++) {
            Map<String, Object> e = entries.get(i);
            sb.append(
                    coalesce(e.get("course_code"), e.get("course_name"), "")
            ).append(' ').append(str(e, "day"))
             .append(' ').append(str(e, "time_start"))
             .append(' ').append(str(e, "group"))
             .append('\n');
        }
        return sb.toString();
    }

    // -------------------------------------------------------------------------
    // Utility
    // -------------------------------------------------------------------------

    private String str(Map<String, Object> m, String k) {
        Object v = m.get(k); return v == null ? "" : v.toString();
    }
    private String upperStr(Map<String, Object> m, String k) { return str(m, k).toUpperCase(); }
    private String lowerStr(Map<String, Object> m, String k) { return str(m, k).toLowerCase(); }

    private Object coalesce(Object... values) {
        for (Object v : values) if (v != null && !v.toString().isBlank()) return v;
        return "";
    }
}
