const OpenAI = require('openai');

const openai = new OpenAI();
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const MAX_STEPS = 12;

const SYSTEM_PROMPTS = {
  login: `You are a web navigation agent. Your goal is to find the LOGIN page on a university website.
Look for login forms with email/username and password fields, or "Sign in" / "Log in" links.
Respond with a JSON action object. Available actions:
- {"action":"click","text":"visible button/link text"} — click an element by its visible text
- {"action":"click_coords","x":123,"y":456} — click at exact coordinates
- {"action":"done"} — the login form is now visible on screen
- {"action":"fail","reason":"..."} — cannot find login page
Be concise. Return only the JSON object, no explanation.`,

  schedule: `You are a web navigation agent. Your goal is to find the STUDENT SCHEDULE / TIMETABLE page.
Look for links/buttons containing words like "schedule", "timetable", "расписание", "calendar", "classes".
If the schedule is already visible on the current page, respond with "done".
If the page requires authentication (login form, "sign in" prompt, access denied), respond with "need_login".
Respond with a JSON action object. Available actions:
- {"action":"click","text":"visible button/link text"} — click an element by its visible text
- {"action":"click_coords","x":123,"y":456} — click at exact coordinates
- {"action":"done"} — the schedule/timetable is now visible on screen
- {"action":"need_login"} — authentication is required before accessing the schedule
- {"action":"fail","reason":"..."} — cannot find schedule page
Be concise. Return only the JSON object, no explanation.`,
};

class AiNavigator {
  async navigate(page, goal, onStep) {
    for (let step = 0; step < MAX_STEPS; step++) {
      let base64;
      try {
        const screenshot = await page.screenshot({ type: 'jpeg', quality: 75, timeout: 10000 });
        base64 = screenshot.toString('base64');
      } catch (err) {
        onStep({ phase: 'error', step, message: `Screenshot failed: ${err.message}` });
        return 'failed';
      }

      onStep({ phase: 'screenshot', step, screenshot: base64 });

      const pageUrl = page.url();
      const userMessage = `Step ${step + 1}/${MAX_STEPS}. Current URL: ${pageUrl}\nWhat should I do next?`;

      onStep({ phase: 'thinking', step, message: `Step ${step + 1}: Analyzing page...` });

      let action;
      try {
        action = await this.askAI(base64, goal, userMessage);
      } catch (err) {
        onStep({ phase: 'error', step, message: `AI error: ${err.message}` });
        return false;
      }

      onStep({ phase: 'action', step, message: `Action: ${JSON.stringify(action)}` });

      if (action.action === 'done') return 'done';
      if (action.action === 'need_login') {
        onStep({ phase: 'action', step, message: 'Authentication required.' });
        return 'need_login';
      }
      if (action.action === 'fail') {
        onStep({ phase: 'error', step, message: `Navigation failed: ${action.reason || 'unknown'}` });
        return 'failed';
      }

      try {
        await this.executeAction(page, action);
        await page.waitForTimeout(1500);
      } catch (err) {
        onStep({ phase: 'error', step, message: `Action error: ${err.message}` });
      }
    }

    onStep({ phase: 'error', step: MAX_STEPS, message: 'Max steps reached.' });
    return 'failed';
  }

  async askAI(screenshotBase64, goal, userMessage) {
    const response = await openai.chat.completions.create({
      model: MODEL,
      max_tokens: 256,
      messages: [
        { role: 'system', content: SYSTEM_PROMPTS[goal] },
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${screenshotBase64}`, detail: 'low' } },
            { type: 'text', text: userMessage },
          ],
        },
      ],
    });

    const text = response.choices[0]?.message?.content || '';
    return this.parseAction(text);
  }

  parseAction(text) {
    try {
      return JSON.parse(text);
    } catch {
      const match = text.match(/\{[\s\S]*\}/);
      if (match) return JSON.parse(match[0]);
      return { action: 'fail', reason: 'Could not parse AI response' };
    }
  }

  async executeAction(page, action) {
    if (action.action === 'click' && action.text) {
      const selectors = [
        `text="${action.text}"`,
        `a:has-text("${action.text}")`,
        `button:has-text("${action.text}")`,
        `[value="${action.text}"]`,
        `[aria-label="${action.text}"]`,
      ];

      for (const sel of selectors) {
        try {
          const el = page.locator(sel).first();
          if (await el.isVisible({ timeout: 1000 })) {
            await el.click({ timeout: 3000 });
            return;
          }
        } catch {}
      }

      try {
        await page.getByText(action.text, { exact: false }).first().click({ timeout: 3000 });
        return;
      } catch {}

      throw new Error(`Could not find element with text: "${action.text}"`);
    }

    if (action.action === 'click_coords' && action.x != null && action.y != null) {
      await page.mouse.click(action.x, action.y);
      return;
    }
  }
}

module.exports = { AiNavigator };
