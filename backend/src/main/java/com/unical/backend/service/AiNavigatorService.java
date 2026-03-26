package com.unical.backend.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.microsoft.playwright.Page;
import com.openai.client.OpenAIClient;
import com.openai.models.*;
import com.openai.models.chat.completions.*;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.Base64;
import java.util.List;
import java.util.function.Consumer;

/**
 * AI-driven browser navigator.
 *
 * <p>Takes a Playwright {@link Page}, repeatedly screenshots it, asks
 * GPT-4o-vision for the next action toward a goal, and executes that action.
 * Runs up to {@value #MAX_STEPS} steps before giving up.
 *
 * <p>Two goals are supported:
 * <ul>
 *   <li>{@link Goal#LOGIN} — find and reach the university login form.</li>
 *   <li>{@link Goal#SCHEDULE} — find and reach the schedule/timetable page.</li>
 * </ul>
 */
@Service
@Slf4j
@RequiredArgsConstructor
public class AiNavigatorService {

    public enum Goal { LOGIN, SCHEDULE }

    private static final int MAX_STEPS = 12;
    private static final String VISION_MODEL = "gpt-4o";

    private static final String SYSTEM_PROMPT = """
            You are an AI assistant controlling a web browser to help a user reach a specific page.
            You receive a screenshot of the current browser state and must decide the next single action.

            Respond with ONLY valid JSON (no markdown, no prose):
            {
              "done": false,
              "action": "click" | "navigate" | "type" | "scroll" | "wait" | "none",
              "x": <number>,           // viewport x coordinate for click
              "y": <number>,           // viewport y coordinate for click
              "url": "<string>",       // for navigate action
              "text": "<string>",      // for type action
              "selector": "<string>",  // CSS/text selector (optional alternative to x,y)
              "reason": "<string>"     // brief explanation (1 sentence)
            }

            When the goal is reached set "done": true and "action": "none".
            If the goal cannot be reached set "done": true and "action": "give_up".
            """;

    private static final String LOGIN_GOAL_PROMPT = """
            GOAL: Navigate to the university login page.
            Look for login/sign-in links, SSO buttons, or authentication forms.
            When you see a login form with username/password fields OR an SSO login button, set done=true.
            """;

    private static final String SCHEDULE_GOAL_PROMPT = """
            GOAL: Navigate to the student timetable / schedule page.
            Look for links like "Schedule", "Timetable", "Rozvrh", "Stundenplan", "Calendario", etc.
            When you can see a schedule/timetable with course entries and times, set done=true.
            """;

    private final OpenAIClient openAIClient;
    private final ObjectMapper objectMapper;

    /**
     * Drive the browser toward {@code goal} using up to {@value #MAX_STEPS} steps.
     *
     * @param sessionId session ID (for logging only)
     * @param page      Playwright page to control
     * @param goal      the navigation goal
     * @param logSink   consumer for progress messages
     * @return {@code true} if the goal was reached, {@code false} otherwise
     */
    public boolean navigateToGoal(
            java.util.UUID sessionId,
            Page page,
            Goal goal,
            Consumer<String> logSink
    ) {
        String goalPrompt = goal == Goal.LOGIN ? LOGIN_GOAL_PROMPT : SCHEDULE_GOAL_PROMPT;

        for (int step = 1; step <= MAX_STEPS; step++) {
            log.info("[{}] Step {}/{} — goal={}", sessionId, step, MAX_STEPS, goal);
            logSink.accept(String.format("Step %d/%d — goal=%s", step, MAX_STEPS, goal));

            byte[] screenshotBytes;
            try {
                screenshotBytes = page.screenshot(
                        new Page.ScreenshotOptions().setFullPage(false)
                );
            } catch (Exception e) {
                log.warn("[{}] Screenshot failed: {}", sessionId, e.getMessage());
                return false;
            }

            String base64 = Base64.getEncoder().encodeToString(screenshotBytes);
            JsonNode decision = askVision(base64, goalPrompt);
            if (decision == null) {
                logSink.accept("Vision API returned no decision at step " + step);
                continue;
            }

            boolean done = decision.path("done").asBoolean(false);
            String action = decision.path("action").asText("none");
            String reason = decision.path("reason").asText("");

            logSink.accept(String.format("  action=%s done=%s reason=%s", action, done, reason));

            if (done) {
                if ("give_up".equals(action)) {
                    logSink.accept("AI gave up reaching goal: " + goal);
                    return false;
                }
                return true;
            }

            try {
                executeAction(page, decision);
                page.waitForLoadState();
                Thread.sleep(800);
            } catch (Exception e) {
                log.warn("[{}] Action execution error: {}", sessionId, e.getMessage());
            }
        }

        logSink.accept("Reached max steps (" + MAX_STEPS + ") without completing goal " + goal);
        return false;
    }

    // -------------------------------------------------------------------------
    // Vision API call
    // -------------------------------------------------------------------------

    private JsonNode askVision(String base64Screenshot, String goalPrompt) {
        try {
            String userText = goalPrompt + "\n\nLook at the screenshot and decide the next action.";

            ChatCompletionCreateParams params = ChatCompletionCreateParams.builder()
                    .model(ChatModel.GPT_4O)
                    .maxCompletionTokens(512)
                    .temperature(0.0)
                    .messages(List.of(
                            ChatCompletionMessageParam.ofSystem(
                                    ChatCompletionSystemMessageParam.builder()
                                            .content(SYSTEM_PROMPT)
                                            .build()
                            ),
                            ChatCompletionMessageParam.ofUser(
                                    ChatCompletionUserMessageParam.builder()
                                            .content(ChatCompletionUserMessageParam.Content.ofArrayOfContentParts(
                                                    List.of(
                                                            ChatCompletionContentPart.ofText(
                                                                    ChatCompletionContentPartText.builder()
                                                                            .text(userText)
                                                                            .build()
                                                            ),
                                                            ChatCompletionContentPart.ofImageUrl(
                                                                    ChatCompletionContentPartImage.builder()
                                                                            .imageUrl(
                                                                                    ChatCompletionContentPartImage.ImageUrl.builder()
                                                                                            .url("data:image/png;base64," + base64Screenshot)
                                                                                            .detail(ChatCompletionContentPartImage.ImageUrl.Detail.AUTO)
                                                                                            .build()
                                                                            )
                                                                            .build()
                                                            )
                                                    )
                                            ))
                                            .build()
                            )
                    ))
                    .build();

            ChatCompletion completion = openAIClient.chat().completions().create(params);
            String raw = completion.choices().get(0).message().content().orElse("{}");
            raw = raw.strip();
            if (raw.startsWith("```")) {
                raw = raw.replaceAll("```(?:json)?\\s*", "").replaceAll("```\\s*$", "").strip();
            }
            return objectMapper.readTree(raw);

        } catch (Exception e) {
            log.error("Vision API call failed: {}", e.getMessage());
            return null;
        }
    }

    // -------------------------------------------------------------------------
    // Action execution
    // -------------------------------------------------------------------------

    private void executeAction(Page page, JsonNode decision) {
        String action = decision.path("action").asText("none");

        switch (action) {
            case "click" -> {
                if (decision.has("selector")) {
                    page.locator(decision.get("selector").asText()).first().click();
                } else {
                    int x = decision.path("x").asInt();
                    int y = decision.path("y").asInt();
                    page.mouse().click(x, y);
                }
            }
            case "navigate" -> {
                String url = decision.path("url").asText();
                if (!url.isBlank()) page.navigate(url);
            }
            case "type" -> {
                String text = decision.path("text").asText();
                if (decision.has("selector")) {
                    page.locator(decision.get("selector").asText()).first().fill(text);
                } else {
                    page.keyboard().type(text);
                }
            }
            case "scroll" -> {
                int x = decision.path("x").asInt(0);
                int y = decision.path("y").asInt(300);
                page.mouse().wheel(0, y);
            }
            case "wait", "none" -> {
                // intentional no-op; waitForLoadState is called by the caller
            }
            default -> log.warn("Unknown action '{}' — skipping.", action);
        }
    }
}
