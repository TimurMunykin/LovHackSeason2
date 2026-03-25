const OpenAI = require('openai');

const client = new OpenAI();

const SYSTEM_PROMPT = `You are a browser navigation agent. Your task is to navigate a university website to find the login/sign-in page where a student would enter their credentials (username/email and password).

You will receive a screenshot of the current page. Analyze it and decide what to do next.

IMPORTANT RULES:
- Look for links or buttons like "Login", "Sign In", "Log In", "Student Portal", "My Account", "SSO", etc.
- If you see a login FORM with input fields for username/email and password, the task is DONE.
- If you see an SSO/CAS redirect page or Microsoft/Google login page, the task is DONE.
- Do NOT type anything into fields. Just navigate to the login page.
- Be efficient — pick the most obvious login link first.
- If the page has a cookie consent banner, dismiss it first.

Respond with EXACTLY one JSON object, no other text:

If login form is found:
{"action": "done", "reason": "description of what you see"}

If you need to click something:
{"action": "click", "target": "exact visible text of the link/button to click"}

If you need to click by position (no clear text):
{"action": "click_coords", "x": 500, "y": 300, "reason": "what you're clicking"}

If you're stuck or the page seems wrong:
{"action": "fail", "reason": "why navigation failed"}`;

const MAX_STEPS = 12;

class AiNavigator {
  constructor() {
    this.steps = [];
    this.running = false;
  }

  async navigate(page, onStep) {
    this.running = true;
    this.steps = [];

    for (let i = 0; i < MAX_STEPS && this.running; i++) {
      const stepNum = i + 1;
      onStep({ step: stepNum, phase: 'screenshot', message: `Step ${stepNum}: Analyzing page...` });

      await page.waitForLoadState('domcontentloaded').catch(() => {});
      await page.waitForTimeout(1500);

      const screenshot = await page.screenshot({ type: 'jpeg', quality: 75 });
      const base64 = screenshot.toString('base64');

      let action;
      try {
        onStep({ step: stepNum, phase: 'thinking', message: `Step ${stepNum}: AI is deciding next action...` });
        action = await this.askGPT(base64);
        onStep({ step: stepNum, phase: 'action', message: `Step ${stepNum}: ${this.describeAction(action)}` });
      } catch (err) {
        this.steps.push({ step: stepNum, error: err.message });
        onStep({ step: stepNum, phase: 'error', message: `Step ${stepNum}: AI error — ${err.message}` });
        continue;
      }

      this.steps.push({ step: stepNum, action });

      if (action.action === 'done') {
        return { success: true, reason: action.reason, steps: this.steps };
      }

      if (action.action === 'fail') {
        return { success: false, reason: action.reason, steps: this.steps };
      }

      try {
        await this.executeAction(page, action);
      } catch (err) {
        onStep({ step: stepNum, phase: 'error', message: `Step ${stepNum}: Click failed — ${err.message}` });
        this.steps.push({ step: stepNum, error: `Action failed: ${err.message}` });
      }
    }

    return { success: false, reason: 'Max navigation steps reached', steps: this.steps };
  }

  stop() {
    this.running = false;
  }

  async askGPT(screenshotBase64) {
    const response = await client.responses.create({
      model: 'gpt-5.4-mini',
      max_output_tokens: 256,
      reasoning: { effort: 'none' },
      text: { verbosity: 'low' },
      input: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            {
              type: 'input_image',
              image_url: `data:image/jpeg;base64,${screenshotBase64}`,
              detail: 'low',
            },
            {
              type: 'input_text',
              text: 'What should I do on this page to reach the login form?',
            },
          ],
        },
      ],
    });

    const text = response.output_text.trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('AI returned non-JSON response');
    return JSON.parse(jsonMatch[0]);
  }

  async executeAction(page, action) {
    if (action.action === 'click') {
      const target = action.target;
      const el =
        (await page.$(`text="${target}"`)) ||
        (await page.$(`a:has-text("${target}")`)) ||
        (await page.$(`button:has-text("${target}")`)) ||
        (await page.$(`[value="${target}"]`)) ||
        (await page.$(`[aria-label="${target}"]`));

      if (el) {
        await el.click();
      } else {
        await page.getByText(target, { exact: false }).first().click({ timeout: 5000 });
      }
    } else if (action.action === 'click_coords') {
      await page.mouse.click(action.x, action.y);
    }
  }

  describeAction(action) {
    switch (action.action) {
      case 'done':
        return `Login page found! ${action.reason}`;
      case 'click':
        return `Clicking "${action.target}"`;
      case 'click_coords':
        return `Clicking at (${action.x}, ${action.y}) — ${action.reason}`;
      case 'fail':
        return `Navigation failed: ${action.reason}`;
      default:
        return JSON.stringify(action);
    }
  }
}

module.exports = { AiNavigator };
