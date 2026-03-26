const { chromium } = require('playwright');
const { spawn } = require('child_process');
const { AiNavigator } = require('./ai-navigator');
const { extractSchedule } = require('./schedule-extractor');

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
    this.setStatus('starting');

    // Start Xvfb virtual display
    const xvfb = spawn('Xvfb', [this.display, '-screen', '0', `${VIEWPORT.width}x${VIEWPORT.height}x24`]);
    this.processes.push(xvfb);
    await new Promise((r) => setTimeout(r, 500));

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

    // Start by looking for the schedule directly
    this.findSchedule();
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
    this.addLog('action', 'Looking for schedule...');

    const navigator = new AiNavigator();
    const result = await navigator.navigate(this.page, 'schedule', (step) => {
      this.aiLog.push(step);
      this.emitEvent('log', step);
    });

    if (result === 'done') {
      await this.extractScheduleData();
    } else if (result === 'need_login') {
      this.addLog('action', 'Login required. Looking for login page...');
      await this.findLogin();
    } else {
      this.setStatus('failed');
      this.result = { error: 'Could not find the schedule page.' };
      this.addLog('error', 'Failed to find schedule page.');
    }
  }

  async findLogin() {
    this.setStatus('navigating_login');
    const navigator = new AiNavigator();

    const result = await navigator.navigate(this.page, 'login', (step) => {
      this.aiLog.push(step);
      this.emitEvent('log', step);
    });

    if (result === 'done') {
      this.setStatus('active');
      this.addLog('handoff', 'Login page found. Please log in and click "I\'ve completed login".');
    } else {
      this.setStatus('failed');
      this.result = { error: 'Could not find the login page.' };
      this.addLog('error', 'Failed to find login page.');
    }
  }

  async confirm() {
    if (this.status !== 'active') return;
    // After user logs in, go look for schedule again
    await this.findSchedule();
  }

  async extractScheduleData() {
    this.setStatus('extracting');
    this.addLog('action', 'Schedule page found. Extracting data...');

    const extraction = await extractSchedule(this.page, this.networkLog);
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
      },
    };

    this.setStatus(extraction.items.length > 0 ? 'success' : 'failed');
    this.addLog(
      extraction.items.length > 0 ? 'action' : 'error',
      extraction.items.length > 0
        ? `Extracted ${extraction.items.length} schedule entries (${extraction.source}).`
        : 'No schedule data found.'
    );
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
