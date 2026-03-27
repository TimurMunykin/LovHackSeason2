const OpenAI = require('openai');

const openai = new OpenAI();
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o';

const MAX_NAV_STEPS = 15;
const MAX_COLLECT_STEPS = 50;

// ─────────────────────────────────────────────────────────────────────────────
// System prompts
// ─────────────────────────────────────────────────────────────────────────────

const LOGIN_PROMPT = `\
You are a web navigation agent. Your goal is to reach the LOGIN page on a university website.
Look for login forms with email/username and password fields, or "Sign in" / "Log in" / "SSO" links.

Respond with ONLY a JSON object — no prose, no markdown:
- {"action":"click","text":"visible button/link text"} — click an element by its visible text
- {"action":"click_coords","x":123,"y":456} — click at exact pixel coordinates
- {"action":"done"} — a login form is now visible on screen
- {"action":"fail","reason":"..."} — cannot find a login page on this site`;

const SCHEDULE_FIND_PROMPT = `\
You are a web navigation agent. Your ONLY goal is to reach the page that shows the student's
SCHEDULE / TIMETABLE — a grid or list of courses with days, times, rooms, and teachers.

HOW TO RECOGNIZE SUCCESS (respond immediately with "done"):
- A timetable GRID or weekly calendar is visible with time slots on one axis and days on the other.
- A LIST of class sessions showing course name + day/date + time (e.g. "09:15–10:45") is visible.
- The page heading or tab label says "Schedule", "Timetable", "Rozvrh", "Stundenplan",
  "Orario", "Emploi du temps", or equivalent in any language.
If you are unsure, respond "done" — it is better to try collecting than to keep navigating.

DO NOT navigate to these pages — they are NOT the timetable:
- Course catalog / course list (shows course descriptions without time slots)
- Grades, transcripts, exam results
- Academic terms / semester settings or calendar of holidays
- Registration or enrollment pages
- Profile, account, or notification settings
- Any page whose main content is a single course detail page

PRIORITY CLICK ORDER (try in this order, stop as soon as "done"):
1. Any nav link/tab literally labelled: Schedule | Timetable | Rozvrh | Stundenplan | Orario | My schedule
2. A "Student portal" or "Personal area" section — look for schedule inside it
3. A sidebar/menu item related to classes or courses that might contain a timetable sub-item
4. If none of the above found after 3 attempts → navigate directly to a guessed URL on the same domain
   (try: /schedule, /timetable, /rozvrh, /student/timetable, /my-schedule, /courses/schedule)

DROPDOWN / SUBMENU HANDLING:
- Some nav items (e.g. "Schedules", "Courses") open a DROPDOWN MENU when clicked rather than
  navigating to a new page. The URL stays the same but new items appear below the button.
- If you clicked something and the URL did not change, a dropdown likely appeared.
  You MUST click one of the newly visible items INSIDE the dropdown on your very next action.
  Do NOT click the same top-level button again — that would just close/reopen it.
- You will be warned explicitly when this situation occurs.

ANTI-LOOP RULES:
- You will receive the full list of actions already tried. NEVER repeat any of them.
- If a click changed nothing (URL same, no dropdown visible), try a completely different element.
- After 3 failed clicks with no progress, switch to a direct URL navigate attempt.

Respond with ONLY a JSON object — no prose, no markdown:
- {"action":"click","text":"exact visible text of the link or button to click"}
- {"action":"click_coords","x":123,"y":456} — only when no readable text is available
- {"action":"navigate","url":"https://..."} — jump directly to a URL
- {"action":"scroll","direction":"down"} — scroll to reveal hidden links
- {"action":"done"} — the schedule/timetable is now visible on screen
- {"action":"need_login"} — a login wall is blocking access
- {"action":"fail","reason":"..."} — truly unable to find schedule after all options exhausted`;

const SCHEDULE_COLLECT_PROMPT = `\
You are a university schedule extraction agent controlling a web browser.
Your job is to extract a COMPLETE, ACCURATE schedule from the current timetable page.

━━━ STEP A — EXTRACT ENTRIES FROM THE CURRENT VIEW ━━━
Extract every schedule entry visible right now.

CRITICAL — HOW TO DETERMINE THE DAY OF WEEK:
- In a weekly GRID: the day is ALWAYS the column header directly above the entry block
  (e.g. "Monday", "Mo", "Montag", "Pondělí"). NEVER guess from position alone.
- In a LIST view: the day is written next to or above the entry.
- If a date is shown (e.g. "2025-03-10"), derive the day from the date.
- If you cannot determine the day with certainty, set "day": null rather than guessing.

ENTRY FIELDS — include only fields you can actually read; omit the rest:
  course_code    e.g. "CS101"
  course_name    e.g. "Introduction to Algorithms"
  day            full English day name: "Monday" | "Tuesday" | "Wednesday" | "Thursday" | "Friday" | "Saturday" | "Sunday"
  date           ISO date if shown, e.g. "2025-03-10"
  time_start     24-h "HH:MM"
  time_end       24-h "HH:MM"
  teacher        e.g. "Smith J."
  room           e.g. "A-101"
  group          e.g. "Group A"
  type           "lecture" | "seminar" | "lab" | "tutorial" | exact text shown
  week_parity    "odd" | "even" | null
  note           any extra visible info

━━━ STEP B — CLICK ENTRIES FOR FULL DETAILS ━━━
Many timetable systems show compact entries in the grid and reveal full info (room, teacher,
type, group) only when you click the entry.

Rules:
- After extracting this view, identify ALL entries that appear CLICKABLE (colored blocks,
  underlined text, links, entries with a "details" arrow or "ℹ" icon).
- You will be told which entry texts have already been detail-clicked. For any that have NOT
  been clicked yet, use action="click_entry" to open the first unclicked one.
- Return entries_this_view with the FULL details you see on the detail/popup page.
- Then use action="go_back" to return to the schedule overview and continue.
- Repeat until all clickable entries on the current view have been detail-clicked.

━━━ STEP C — NAVIGATE TO MORE VIEWS ━━━
After all entries on the current view are extracted and detail-clicked:
- Use week/period navigation (prev/next arrows, "next week" buttons, date pickers).
- Try view-type switchers (week / month / list / semester) to find the fullest view.
- Check for semester or term selectors if only a partial term is shown.
- Verify empty days: look for holiday banners, "no classes", greyed-out dates, or holiday names.
  Include a holiday entry only if there is explicit text evidence.

━━━ RESPONSE FORMAT — ONLY valid JSON, no markdown, no prose ━━━
{
  "entries_this_view": [ { ...entry fields... }, ... ],
  "action": "extract_and_continue" | "click_entry" | "go_back" | "done",
  "click_text": "exact visible text of element to click, or null",
  "click_x": null,
  "click_y": null,
  "reason": "one sentence",
  "is_complete": false
}

ACTION RULES:
  extract_and_continue — extracted this view; now navigate to next week/view
  click_entry          — opening a specific entry for full details
  go_back              — finished reading a detail page; returning to overview
  done                 — ALL views navigated AND all clickable entries detail-checked

- Prefer click_text over click_x/click_y.
- Set is_complete=true and action=done ONLY when you have: (a) navigated all weeks/periods,
  AND (b) detail-clicked every clickable entry on every view.
- Never mark done after just one view if navigation controls (arrows, tabs) are present.`;

// ─────────────────────────────────────────────────────────────────────────────
// AiNavigator
// ─────────────────────────────────────────────────────────────────────────────

class AiNavigator {
  constructor() {
    this._collectedEntries = [];
    this._visitedUrls = new Set();
    this._entryKeys = new Set();
    this._detailedEntryTexts = new Set(); // tracks which entry texts have been detail-clicked
    this._lastClickedText = null;         // text of entry we just clicked into (for merging on go_back)
  }

  // ── Phase 1: navigate to a goal page ──────────────────────────────────────

  /**
   * Navigate toward `goal` ("login" | "schedule").
   * Returns "done" | "need_login" | "failed".
   */
  async navigate(page, goal, onStep) {
    const systemPrompt = goal === 'login' ? LOGIN_PROMPT : SCHEDULE_FIND_PROMPT;
    const triedActions = [];
    // When a click doesn't navigate (URL unchanged), we pass a specific warning to the AI
    // so it understands a dropdown/submenu may have appeared and knows to click inside it.
    let lastClickHint = null;

    for (let step = 0; step < MAX_NAV_STEPS; step++) {
      const base64 = await this._screenshot(page, onStep, step);
      if (!base64) return 'failed';

      onStep({ phase: 'thinking', message: `Step ${step + 1}/${MAX_NAV_STEPS}: analysing page…` });

      let action;
      try {
        action = await this._askNavigation(base64, systemPrompt, page.url(), step + 1, MAX_NAV_STEPS, triedActions, lastClickHint);
      } catch (err) {
        onStep({ phase: 'error', message: `AI error: ${err.message}` });
        return 'failed';
      }

      lastClickHint = null; // reset; will be set below if click doesn't navigate

      onStep({ phase: 'action', message: `→ ${JSON.stringify(action)}` });

      if (action.action === 'done') return 'done';
      if (action.action === 'need_login') return 'need_login';
      if (action.action === 'fail') {
        onStep({ phase: 'error', message: `Navigation failed: ${action.reason || 'unknown'}` });
        return 'failed';
      }

      const urlBefore = page.url();
      triedActions.push({
        step: step + 1,
        action: action.action,
        text: action.text || null,
        url: action.url || null,
        pageUrl: urlBefore,
      });

      try {
        await this._executeNavAction(page, action);
        await page.waitForTimeout(1800);
        const urlAfter = page.url();
        if (urlAfter === urlBefore && (action.action === 'click' || action.action === 'click_coords')) {
          // URL didn't change — likely a dropdown/submenu opened. Tell the AI explicitly.
          lastClickHint = `⚠ Your last click on "${action.text || 'that element'}" did NOT navigate to a new page (URL is still the same). ` +
            `This means it probably opened a DROPDOWN MENU or SUBMENU below the button. ` +
            `Look at the screenshot carefully — new items have likely appeared below the button you clicked. ` +
            `Your NEXT action MUST click one of those newly visible dropdown/submenu items. ` +
            `Do NOT click "${action.text || 'that element'}" again.`;
          onStep({ phase: 'thinking', message: `URL unchanged after click — dropdown may have opened` });
        }
      } catch (err) {
        onStep({ phase: 'error', message: `Action error: ${err.message}` });
      }
    }

    onStep({ phase: 'error', message: 'Max navigation steps reached.' });
    return 'failed';
  }

  // ── Phase 2: collect full schedule ────────────────────────────────────────

  /**
   * Collect the complete schedule starting from the current page.
   * Returns an array of entry objects.
   */
  async collectSchedule(page, onStep) {
    this._collectedEntries = [];
    this._visitedUrls = new Set();
    this._entryKeys = new Set();
    this._detailedEntryTexts = new Set();
    this._lastClickedText = null;

    for (let step = 0; step < MAX_COLLECT_STEPS; step++) {
      const base64 = await this._screenshot(page, onStep, step, 'high');
      if (!base64) break;

      const currentUrl = page.url();
      this._visitedUrls.add(currentUrl);
      const totalSoFar = this._collectedEntries.length;

      onStep({
        phase: 'thinking',
        message: `Collect ${step + 1}/${MAX_COLLECT_STEPS}: ${totalSoFar} entries so far`,
      });

      let decision;
      try {
        decision = await this._askCollection(base64, currentUrl, step + 1, totalSoFar);
      } catch (err) {
        onStep({ phase: 'error', message: `AI error: ${err.message}` });
        break;
      }

      // Merge entries: add new ones, UPDATE existing ones with richer detail data.
      // This is important when the AI returns full details after clicking into an entry.
      const newEntries = Array.isArray(decision.entries_this_view) ? decision.entries_this_view : [];
      let added = 0;
      let merged = 0;
      for (const entry of newEntries) {
        const key = [
          entry.course_code || '',
          entry.course_name || '',
          entry.day || '',
          entry.date || '',
          entry.time_start || '',
        ].join('|');
        if (!this._entryKeys.has(key)) {
          this._entryKeys.add(key);
          this._collectedEntries.push(entry);
          added++;
        } else {
          // Overwrite existing entry with richer detail fields (room, teacher, type, etc.)
          const idx = this._collectedEntries.findIndex((e) => [
            e.course_code || '', e.course_name || '', e.day || '', e.date || '', e.time_start || '',
          ].join('|') === key);
          if (idx !== -1) {
            this._collectedEntries[idx] = { ...this._collectedEntries[idx], ...entry };
            merged++;
          }
        }
      }

      onStep({
        phase: 'action',
        message: `+${added} new, ~${merged} updated (${this._collectedEntries.length} total) — ${decision.action}: ${decision.reason || ''}`,
      });

      if (decision.action === 'done' || decision.is_complete) {
        onStep({ phase: 'action', message: `✓ Collection complete — ${this._collectedEntries.length} entries` });
        break;
      }

      // Execute the next navigation action
      try {
        if (decision.action === 'go_back') {
          // Mark the previously clicked entry as detail-done
          if (this._lastClickedText) {
            this._detailedEntryTexts.add(this._lastClickedText);
            this._lastClickedText = null;
          }
          await page.goBack({ waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => page.goBack());
          await page.waitForTimeout(1000);
        } else if (decision.action === 'click_entry' && decision.click_text) {
          this._lastClickedText = decision.click_text;
          this._detailedEntryTexts.add(decision.click_text);
          await this._clickByText(page, decision.click_text);
          await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
          await page.waitForTimeout(1200);
        } else if (decision.click_text) {
          await this._clickByText(page, decision.click_text);
          await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
          await page.waitForTimeout(1200);
        } else if (decision.click_x != null && decision.click_y != null) {
          await page.mouse.click(decision.click_x, decision.click_y);
          await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
          await page.waitForTimeout(1200);
        }
      } catch (err) {
        onStep({ phase: 'error', message: `Navigation error: ${err.message}` });
      }
    }

    return this._collectedEntries;
  }

  // ── AI calls ──────────────────────────────────────────────────────────────

  async _askNavigation(base64, systemPrompt, url, stepNum, maxSteps, triedActions = [], lastClickHint = null) {
    const historyNote = triedActions.length > 0
      ? `\n\nActions already tried (DO NOT repeat these):\n${triedActions.map(
          a => `  Step ${a.step}: ${a.action}${a.text ? ` "${a.text}"` : ''}${a.url ? ` → ${a.url}` : ''} (was on: ${a.pageUrl})`
        ).join('\n')}`
      : '';

    const hintNote = lastClickHint ? `\n\n${lastClickHint}` : '';

    const response = await openai.chat.completions.create({
      model: MODEL,
      max_tokens: 300,
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64}`, detail: 'low' } },
            {
              type: 'text',
              text: `Step ${stepNum}/${maxSteps}. Current URL: ${url}${historyNote}${hintNote}\n\nWhat should I do next?`,
            },
          ],
        },
      ],
    });
    return this._parseJSON(response.choices[0]?.message?.content || '');
  }

  async _askCollection(base64, url, stepNum, collectedSoFar) {
    const detailedList = [...this._detailedEntryTexts];
    const detailNote = detailedList.length > 0
      ? `\nEntries already detail-clicked (DO NOT click these again):\n${detailedList.map(t => `  - "${t}"`).join('\n')}`
      : '\nNo entries have been detail-clicked yet.';

    const userText = `\
Collection step ${stepNum}/${MAX_COLLECT_STEPS}.
Current URL: ${url}
Total entries collected so far: ${collectedSoFar}
Visited URLs: ${[...this._visitedUrls].join(', ')}
${detailNote}

Follow the 3-step process (A: extract, B: click unclicked entries, C: navigate) and respond with JSON.`;

    const response = await openai.chat.completions.create({
      model: MODEL,
      max_tokens: 4096,
      messages: [
        { role: 'system', content: SCHEDULE_COLLECT_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64}`, detail: 'high' } },
            { type: 'text', text: userText },
          ],
        },
      ],
    });

    return this._parseJSON(
      response.choices[0]?.message?.content || '',
      { entries_this_view: [], action: 'done', is_complete: true, reason: 'parse fallback' },
    );
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  async _screenshot(page, onStep, step, detail = 'low') {
    try {
      // For collection ('high') use fullPage to capture the entire scrollable schedule.
      // For navigation ('low') a viewport screenshot is enough and keeps the image small.
      const fullPage = detail === 'high';
      const buf = await page.screenshot({
        type: 'jpeg',
        quality: detail === 'high' ? 80 : 70,
        fullPage,
        timeout: 15000,
      });
      return buf.toString('base64');
    } catch (err) {
      onStep({ phase: 'error', message: `Screenshot failed: ${err.message}` });
      return null;
    }
  }

  async _executeNavAction(page, action) {
    if (action.action === 'click' && action.text) {
      await this._clickByText(page, action.text);
    } else if (action.action === 'click_coords') {
      await page.mouse.click(action.x, action.y);
    } else if (action.action === 'navigate' && action.url) {
      await page.goto(action.url, { waitUntil: 'domcontentloaded' });
    } else if (action.action === 'scroll') {
      const dir = action.direction === 'up' ? -600 : 600;
      await page.mouse.wheel(0, dir);
      await page.waitForTimeout(500);
    }
  }

  async _clickByText(page, text) {
    const selectors = [
      `text="${text}"`,
      `a:has-text("${text}")`,
      `button:has-text("${text}")`,
      `[aria-label="${text}"]`,
      `[title="${text}"]`,
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
    // Fuzzy fallback
    await page.getByText(text, { exact: false }).first().click({ timeout: 3000 });
  }

  _parseJSON(text, fallback = { action: 'fail', reason: 'Could not parse AI response' }) {
    const s = text.trim();
    // Strip markdown code fences if present
    const inner = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
    try {
      return JSON.parse(inner);
    } catch {
      const match = inner.match(/\{[\s\S]*\}/);
      if (match) {
        try { return JSON.parse(match[0]); } catch {}
      }
      return fallback;
    }
  }
}

module.exports = { AiNavigator };
