const { chromium } = require('playwright');
const { spawn } = require('child_process');
const { AiNavigator } = require('./ai-navigator');
const {
  extractScheduleFromHtmls,
  getPageHtml,
  normalizeScheduleSnapshot,
} = require('./schedule-extractor');

const VIEWPORT = { width: 1280, height: 800 };

class BrowserSession {
  constructor(sessionId, displayNum) {
    this.sessionId = sessionId;
    this.displayNum = displayNum;
    this.display = `:${displayNum}`;
    this.vncPort = 5900 + displayNum;
    this.browser = null;
    this.context = null;
    this.page = null;
    this.status = 'idle';
    this.currentUrl = '';
    this.pageTitle = '';
    this.aiLog = [];
    this.networkLog = [];
    this.result = null;
    this.sseClients = [];
    this.processes = [];
  }

  async start(url) {
    console.log(`[session:${this.sessionId}] starting → ${url}`);
    this.setStatus('starting');

    // Start Xvfb virtual display
    const xvfb = spawn('Xvfb', [this.display, '-screen', '0', `${VIEWPORT.width}x${VIEWPORT.height}x24`]);
    this.processes.push(xvfb);
    await new Promise((r) => setTimeout(r, 1500));

    // Start x11vnc on the display
    const vnc = spawn('x11vnc', [
      '-display', this.display,
      '-nopw', '-shared', '-forever',
      '-rfbport', String(this.vncPort),
    ]);
    this.processes.push(vnc);

    // Launch visible browser on the virtual display
    this.browser = await chromium.launch({
      headless: false,
      args: [
        '--no-sandbox',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        `--display=${this.display}`,
      ],
      env: { ...process.env, DISPLAY: this.display },
    });

    this.context = await this.browser.newContext({ viewport: VIEWPORT });
    this.page = await this.context.newPage();
    this.attachPageListeners();

    await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    this.currentUrl = this.page.url();
    this.pageTitle = await this.page.title();

    // Wait for the user to log in manually, then click "I've completed login".
    this.setStatus('active');
    this.addLog('handoff', 'Page is open. Please log in if needed, then click "I\'ve completed login".');
  }

  attachPageListeners() {
    this.page.on('framenavigated', async (frame) => {
      if (frame === this.page.mainFrame()) {
        this.currentUrl = frame.url();
        try { this.pageTitle = await this.page.title(); } catch {}
        this.emitEvent('status', this.getStatusPayload());
      }
    });

    this.page.on('response', async (response) => {
      if (!['navigating_schedule', 'extracting'].includes(this.status)) return;
      try {
        const contentType = response.headers()['content-type'] || '';
        if (!contentType.match(/json|javascript|text|html/i)) return;
        const url = response.url();
        const status = response.status();
        const body = await response.text().catch(() => null);
        if (!body || body.length > 300000) return;
        let json = null;
        try { json = JSON.parse(body); } catch {}
        this.networkLog.push({ url, status, contentType, json, textSample: body.slice(0, 2000) });
      } catch {}
    });
  }

  async findSchedule() {
    this.networkLog = [];
    this.setStatus('navigating_schedule');
    this.addLog('action', 'Looking for schedule page...');

    const navigator = new AiNavigator();
    const result = await navigator.navigate(this.page, (step) => {
      this.aiLog.push(step);
      this.emitEvent('log', step);
    });

    if (result === 'done') {
      await this.extractScheduleData();
    } else if (result === 'need_login') {
      // User wasn't fully logged in yet — go back to waiting state
      this.setStatus('active');
      this.addLog('handoff', 'Login still required. Please finish logging in and click "I\'ve completed login" again.');
    } else {
      this.setStatus('failed');
      this.result = { error: 'Could not find the schedule page.' };
      this.addLog('error', 'Failed to find schedule page.');
    }
  }

  async confirm() {
    if (this.status !== 'active') return;
    // User confirmed login — now find and extract the schedule
    this.findSchedule().catch((err) => {
      this.setStatus('failed');
      this.result = { error: err.message };
      this.addLog('error', `Unexpected error: ${err.message}`);
    });
  }

  async extractScheduleData() {
    this.setStatus('extracting');
    this.addLog('action', 'Schedule page found. Collecting all weeks...');

    let htmlSnapshots;
    try {
      htmlSnapshots = await this._collectAllWeeksHtml();
    } catch (err) {
      console.error('[collectAllWeeksHtml]', err.message);
      this.setStatus('failed');
      this.result = { error: `Week collection error: ${err.message}` };
      this.addLog('error', `Failed to collect weeks: ${err.message}`);
      return;
    }

    this.addLog('action', `Collected ${htmlSnapshots.length} week(s). Extracting schedule...`);

    let extraction;
    try {
      extraction = await extractScheduleFromHtmls(htmlSnapshots);
    } catch (err) {
      console.error('[extractScheduleData]', err.message);
      this.setStatus('failed');
      this.result = { error: `Extraction error: ${err.message}` };
      this.addLog('error', `Extraction failed: ${err.message}`);
      return;
    }

    let screenshotBase64 = null;
    try {
      const buf = await this.page.screenshot({ type: 'jpeg', quality: 75 });
      screenshotBase64 = buf.toString('base64');
    } catch {}

    this.result = {
      scheduleFound: extraction.items.length > 0,
      extractionSource: extraction.source,
      scheduleJson: extraction.items,
      screenshotBase64,
      debug: {
        scheduleUrl: this.currentUrl,
        scheduleTitle: this.pageTitle,
        weeksCollected: htmlSnapshots.length,
      },
    };

    this.setStatus(extraction.items.length > 0 ? 'success' : 'failed');
    this.addLog(
      extraction.items.length > 0 ? 'action' : 'error',
      extraction.items.length > 0
        ? `Extracted ${extraction.items.length} entries from ${htmlSnapshots.length} week(s).`
        : 'No schedule data found.'
    );
  }

  /**
   * Walk through all available weeks on the timetable page, capturing an HTML
   * snapshot of each. Returns raw HTML strings; the extractor minimizes/trim
   * them the same way as extract_schedule.py.
   */
  async _collectAllWeeksHtml() {
    const MAX_WEEKS = 4;
    const htmlSnapshots = [];
    const seenSigs = new Set(); // content-based dedup — works for both SPAs and URL-based nav

    for (let week = 0; week < MAX_WEEKS; week++) {
      await this.page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => {});
      await this.page.waitForTimeout(600);

      // Snapshot this week's HTML (raw — no DOM mutation)
      let html;
      try {
        html = await getPageHtml(this.page);
      } catch (err) {
        this.addLog('error', `Week ${week + 1}: HTML capture failed — ${err.message}`);
        break;
      }

      // Fingerprint on minimized schedule slice so SPA chrome/scripts don't mask real changes.
      const norm = normalizeScheduleSnapshot(html);
      const mid = Math.floor(norm.length / 2);
      const sig =
        norm.slice(0, 200) + '|' + norm.slice(mid - 100, mid + 100) + '|' + norm.slice(-200);
      if (seenSigs.has(sig)) {
        this.addLog('action', `Week ${week + 1}: content unchanged after navigation — stopping.`);
        break;
      }
      seenSigs.add(sig);
      htmlSnapshots.push(html);
      this.addLog('action', `Week ${week + 1}: captured ${Math.round(html.length / 1024)} KB (${this.page.url()})`);

      // ── Find "next week" button by scanning the live DOM ──────────────────
      const clickResult = await this._clickNextWeekButton(week + 1);
      if (!clickResult) break;

      // Give the SPA time to re-render the new week's content
      await this.page.waitForTimeout(2500);
    }

    return htmlSnapshots;
  }

  /**
   * Scan the live DOM for a "next week / next period" control and click it.
   * Returns the text of what was clicked, or null if nothing was found.
   *
   * Uses page.evaluate() so matching and clicking happen inside the browser,
   * avoiding Playwright selector fragility.
   */
  async _clickNextWeekButton(weekNum) {
    // First, log all candidate buttons so we can debug what the page has
    const candidates = await this.page.evaluate(() => {
      const results = [];
      const seen = new Set();
      document.querySelectorAll('button, a, [role="button"], [role="link"], [role="tab"]').forEach(el => {
        const text = (
          el.innerText || el.textContent ||
          el.getAttribute('aria-label') || el.getAttribute('title') || ''
        ).trim().replace(/\s+/g, ' ').slice(0, 60);
        const cls = (typeof el.className === 'string' ? el.className : '').toLowerCase();
        if (text && !seen.has(text)) {
          seen.add(text);
          results.push({ text, cls });
        }
      });
      return results;
    }).catch(() => []);

    this.addLog('action', `Week ${weekNum} nav scan: [${candidates.map(c => `"${c.text}"`).join(', ')}]`);

    // Patterns to match against button text or CSS class names.
    // Ordered from most specific to most general to avoid false positives.
    const TEXT_PATTERNS = [
      // Arrow symbols
      /^[›»→>]$/,
      // English
      /next\s*week/i,
      /next\s*period/i,
      /^next$/i,
      /^forward$/i,
      // Czech / Slovak
      /další/i, /příští/i, /ďalší/i,
      // German
      /nächste/i, /weiter/i,
      // French
      /suivant/i, /semaine\s*suivante/i,
      // Spanish / Italian
      /siguiente/i, /prossim/i,
      // Russian / Ukrainian
      /следующ/i, /наступн/i,
      // Polish
      /następn/i, /kolejn/i,
    ];
    const CLASS_PATTERNS = [
      /fc-next/i, /next-week/i, /nextWeek/i, /btn-next/i,
      /cal-next/i, /arrow-next/i, /week-next/i, /nav-next/i,
    ];

    // Try to click via page.evaluate for reliability
    const clicked = await this.page.evaluate(({ textPatterns, classPatterns }) => {
      const toRe = s => new RegExp(s.source ?? s, s.flags ?? 'i');

      const elements = Array.from(
        document.querySelectorAll('button, a, [role="button"], [role="link"]')
      );

      // Sort: prefer buttons over links, visible elements first
      elements.sort((a, b) => {
        const aVis = a.getBoundingClientRect().width > 0 ? 0 : 1;
        const bVis = b.getBoundingClientRect().width > 0 ? 0 : 1;
        return aVis - bVis;
      });

      for (const el of elements) {
        const text = (
          el.innerText || el.textContent ||
          el.getAttribute('aria-label') || el.getAttribute('title') || ''
        ).trim().replace(/\s+/g, ' ');
        const cls = (typeof el.className === 'string' ? el.className : '');

        const textMatch = textPatterns.some(p => toRe(p).test(text));
        const classMatch = classPatterns.some(p => toRe(p).test(cls));

        if (textMatch || classMatch) {
          el.click();
          return text || cls;
        }
      }
      return null;
    }, {
      textPatterns: TEXT_PATTERNS.map(r => ({ source: r.source, flags: r.flags })),
      classPatterns: CLASS_PATTERNS.map(r => ({ source: r.source, flags: r.flags })),
    }).catch(() => null);

    if (clicked) {
      this.addLog('action', `Week ${weekNum}: clicked "${clicked}" → advancing to next week`);
      return clicked;
    }

    this.addLog('action', `Week ${weekNum}: no "next week" button found — collection complete.`);
    return null;
  }

  async stop() {
    if (this.browser) {
      try { await this.browser.close(); } catch {}
      this.browser = null;
      this.page = null;
      this.context = null;
    }
    for (const proc of this.processes) {
      try { proc.kill(); } catch {}
    }
    this.processes = [];
    for (const client of this.sseClients) {
      try { client.end(); } catch {}
    }
    this.sseClients = [];
  }

  getStatus() {
    return {
      status: this.status,
      url: this.currentUrl,
      title: this.pageTitle,
      aiLog: this.aiLog,
      result: this.result,
      sessionId: this.sessionId,
    };
  }

  getStatusPayload() {
    return { status: this.status, url: this.currentUrl, title: this.pageTitle };
  }

  setStatus(newStatus) {
    this.status = newStatus;
    this.emitEvent('status', this.getStatusPayload());
  }

  addLog(phase, message) {
    const entry = { phase, message };
    this.aiLog.push(entry);
    this.emitEvent('log', entry);
  }

  addSSEClient(res) {
    this.sseClients.push(res);
    res.on('close', () => this.removeSSEClient(res));
  }

  removeSSEClient(res) {
    this.sseClients = this.sseClients.filter((c) => c !== res);
  }

  emitEvent(event, data) {
    const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of this.sseClients) {
      try { client.write(msg); } catch {}
    }
  }
}

module.exports = { BrowserSession };
