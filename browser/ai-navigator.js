const OpenAI = require('openai');

const openai = new OpenAI();
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const MAX_STEPS = 12;

// ─── System prompt ────────────────────────────────────────────────────────────
// The agent receives a screenshot + the real DOM element list + full action
// history on every step. It MUST first describe what it observes (forces
// explicit page-scan reasoning), then decide what to do.

const SCHEDULE_FIND_PROMPT = `\
You are a student who just logged into their university portal and needs to find
their personal class TIMETABLE / SCHEDULE.

On every step you receive:
  • A screenshot of the current browser page
  • INTERACTIVE ELEMENTS — the actual clickable elements extracted from the live DOM
  • HISTORY — every action taken so far and whether the URL changed after it

YOUR TASK — respond with a single JSON object (no prose, no markdown) with these fields:
{
  "observation": "One sentence: describe what page you are on and what navigation options you see.",
  "reasoning":   "One sentence: why you chose this action (or why you declare done/fail).",
  "action":      "click" | "navigate" | "scroll" | "done" | "need_login" | "fail",
  "text":        "exact text from INTERACTIVE ELEMENTS list — only for action=click",
  "url":         "full URL — only for action=navigate",
  "direction":   "down" | "up" — only for action=scroll",
  "reason":      "short reason — only for action=fail"
}

SUCCESS — use action=done as soon as you see ANY of:
• A weekly/daily timetable grid with course blocks placed in time slots
• A table or list showing: day + time + course name + (optionally room/teacher)
• A heading/section labelled Schedule, Timetable, Rozvrh, Stundenplan, Orario, or similar
When in doubt, call done — it is better to start extracting than to keep navigating.

NAVIGATION RULES:
1. Read the INTERACTIVE ELEMENTS list carefully — only click text that appears there exactly.
   Never invent element text from the screenshot alone.
2. Menus and dropdowns: clicking a top-level nav item sometimes opens a submenu without
   changing the URL. The HISTORY will show "URL unchanged". When that happens, look at the
   new elements in the updated INTERACTIVE ELEMENTS list and click a sub-item — never click
   the same top-level item again.
3. Never repeat an action that is already in the HISTORY.
4. After 3+ failed clicks with no URL change, try action=navigate to a guessed path:
   /schedule, /timetable, /rozvrh, /my-schedule, /student/timetable
5. Use action=scroll only to reveal more navigation elements not yet visible.
6. Use action=need_login if a login wall is encountered.
7. Use action=fail only after genuinely exhausting all options.`;

// ─── AiNavigator ─────────────────────────────────────────────────────────────

class AiNavigator {
  // `goal` param kept for backward compatibility but ignored — always finds schedule
  async navigate(page, goalOrOnStep, onStepOrUndefined) {
    const onStep = typeof goalOrOnStep === 'function' ? goalOrOnStep : onStepOrUndefined;
    const history = []; // {step, action, text, url, urlBefore, urlAfter, urlChanged}

    // Wait for the page to fully settle before starting so element scraping works
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});

    for (let step = 0; step < MAX_STEPS; step++) {
      // Gather screenshot + live DOM elements in parallel
      const [base64, elements] = await Promise.all([
        this._screenshot(page).catch(() => null),
        this._getPageElements(page),
      ]);

      if (!base64) {
        onStep({ phase: 'error', step, message: 'Screenshot failed' });
        return 'failed';
      }

      onStep({ phase: 'screenshot', step, screenshot: base64 });
      onStep({ phase: 'thinking', step, message: `Step ${step + 1}/${MAX_STEPS}: scanning page (${elements.length} elements)…` });

      // Build the user message with full context
      const userMessage = this._buildUserMessage(step, page.url(), elements, history);

      let action;
      try {
        action = await this._askAI(base64, userMessage);
      } catch (err) {
        onStep({ phase: 'error', step, message: `AI error: ${err.message}` });
        return 'failed';
      }

      onStep({
        phase: 'action',
        step,
        message: `[${action.observation || ''}] → ${action.action}${action.text ? ` "${action.text}"` : ''}${action.url ? ` ${action.url}` : ''} — ${action.reasoning || ''}`,
      });

      if (action.action === 'done') return 'done';
      if (action.action === 'need_login') return 'need_login';
      if (action.action === 'fail') {
        onStep({ phase: 'error', step, message: `Failed: ${action.reason || 'unknown'}` });
        return 'failed';
      }

      // Execute and record whether the URL actually changed
      const urlBefore = page.url();
      try {
        await this._executeAction(page, action);
        await page.waitForTimeout(1800);
      } catch (err) {
        onStep({ phase: 'error', step, message: `Action error: ${err.message}` });
      }
      const urlAfter = page.url();
      const urlChanged = urlAfter !== urlBefore;

      history.push({
        step: step + 1,
        action: action.action,
        text: action.text || null,
        url: action.url || null,
        urlBefore,
        urlAfter,
        urlChanged,
      });

      if (!urlChanged && (action.action === 'click' || action.action === 'click_coords')) {
        onStep({ phase: 'thinking', step, message: 'URL unchanged — dropdown may have opened, re-scanning elements' });
      }
    }

    onStep({ phase: 'error', step: MAX_STEPS, message: 'Max steps reached.' });
    return 'failed';
  }

  // ── Build the rich user message the AI reads each step ──────────────────────

  _buildUserMessage(step, currentUrl, elements, history) {
    const elementList = elements.length > 0
      ? elements.map(e => `  • ${e.text}${e.href ? `  [${e.href}]` : ''}`).join('\n')
      : '  (none detected)';

    const historyLines = history.length > 0
      ? history.map(h =>
          `  Step ${h.step}: ${h.action}${h.text ? ` "${h.text}"` : ''}${h.url ? ` → ${h.url}` : ''}` +
          ` | URL ${h.urlChanged ? `changed to ${h.urlAfter}` : 'UNCHANGED'}`
        ).join('\n')
      : '  (no actions yet)';

    return `Step ${step + 1}/${MAX_STEPS}
Current URL: ${currentUrl}

INTERACTIVE ELEMENTS on this page (use EXACT text for action=click):
${elementList}

HISTORY of actions taken so far:
${historyLines}

Scan the screenshot together with the element list, then respond with the JSON object.`;
  }

  // ── AI call ──────────────────────────────────────────────────────────────────

  async _askAI(screenshotBase64, userMessage) {
    const response = await openai.chat.completions.create({
      model: MODEL,
      max_completion_tokens: 400,
      messages: [
        { role: 'system', content: SCHEDULE_FIND_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${screenshotBase64}`, detail: 'low' } },
            { type: 'text', text: userMessage },
          ],
        },
      ],
    });
    return this._parseJSON(response.choices[0]?.message?.content || '');
  }

  // ── DOM scraper ──────────────────────────────────────────────────────────────

  async _getPageElements(page) {
    try {
      return await page.evaluate(() => {
        const seen = new Set();
        const results = [];

        // Cast a wide net — include anything interactive or navigational
        const candidates = document.querySelectorAll(
          'a[href], button, [role="button"], [role="menuitem"], [role="tab"],' +
          '[role="link"], [role="option"], [role="treeitem"], [role="menuitemcheckbox"],' +
          'input[type="submit"], input[type="button"], nav a, nav button,' +
          '[class*="nav"] a, [class*="menu"] a, [class*="sidebar"] a,' +
          '[class*="tab"] a, [class*="tab"] button'
        );

        for (const el of candidates) {
          // Only skip elements explicitly hidden via CSS — do NOT filter by pixel size
          // because many SPA nav items are zero-rect before JS finishes painting
          const style = window.getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden') continue;

          const text = (
            el.innerText ||
            el.textContent ||
            el.value ||
            el.getAttribute('aria-label') ||
            el.getAttribute('title') ||
            el.getAttribute('alt') ||
            ''
          ).trim().replace(/\s+/g, ' ');

          if (!text || text.length > 80 || seen.has(text)) continue;
          seen.add(text);

          const item = { text };
          if (el.tagName === 'A' && el.href && !el.href.startsWith('javascript')) {
            try { item.href = new URL(el.href).pathname; } catch {}
          }
          results.push(item);
        }
        return results;
      });
    } catch {
      return [];
    }
  }

  // ── Screenshot ───────────────────────────────────────────────────────────────

  async _screenshot(page) {
    const buf = await page.screenshot({ type: 'jpeg', quality: 70 });
    return buf.toString('base64');
  }

  // ── Action executor ──────────────────────────────────────────────────────────

  async _executeAction(page, action) {
    if (action.action === 'click' && action.text) {
      const selectors = [
        `text="${action.text}"`,
        `a:has-text("${action.text}")`,
        `button:has-text("${action.text}")`,
        `[aria-label="${action.text}"]`,
        `[title="${action.text}"]`,
      ];
      for (const sel of selectors) {
        try {
          const el = page.locator(sel).first();
          if (await el.isVisible({ timeout: 800 })) {
            await el.click({ timeout: 3000 });
            return;
          }
        } catch {}
      }
      // fuzzy fallback
      await page.getByText(action.text, { exact: false }).first().click({ timeout: 3000 });
      return;
    }
    if (action.action === 'navigate' && action.url) {
      await page.goto(action.url, { waitUntil: 'domcontentloaded' });
      return;
    }
    if (action.action === 'scroll') {
      await page.mouse.wheel(0, action.direction === 'up' ? -600 : 600);
      await page.waitForTimeout(400);
      return;
    }
    if (action.action === 'click_coords' && action.x != null && action.y != null) {
      await page.mouse.click(action.x, action.y);
    }
  }

  // ── JSON parser ───────────────────────────────────────────────────────────────

  _parseJSON(text) {
    const s = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
    try { return JSON.parse(s); } catch {}
    const match = s.match(/\{[\s\S]*\}/);
    if (match) { try { return JSON.parse(match[0]); } catch {} }
    return { action: 'fail', reason: 'Could not parse AI response' };
  }
}

module.exports = { AiNavigator };
