const { chromium } = require('playwright');
const { spawn } = require('child_process');
const { AiNavigator } = require('./ai-navigator');

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

    // Wait for the user to log in manually and click "I've completed login".
    this.setStatus('active');
    this.addLog('handoff', 'Page is open. Please log in if required, then click "I\'ve completed login".');
  }

  attachPageListeners() {
    this.page.on('framenavigated', async (frame) => {
      if (frame === this.page.mainFrame()) {
        this.currentUrl = frame.url();
        try { this.pageTitle = await this.page.title(); } catch {}
        this.emitEvent('status', this.getStatusPayload());
      }
    });

  }

  async findSchedule() {
    this.setStatus('navigating_schedule');
    this.addLog('action', 'Looking for schedule page...');

    const navigator = new AiNavigator();
    const navResult = await navigator.navigate(this.page, 'schedule', (step) => {
      this.aiLog.push(step);
      this.emitEvent('log', step);
    });

    if (navResult === 'done') {
      await this.collectScheduleData(navigator);
    } else if (navResult === 'need_login') {
      // User apparently wasn't logged in yet — go back to waiting state
      this.setStatus('active');
      this.addLog('handoff', 'Session appears to require login. Please log in and click "I\'ve completed login" again.');
    } else {
      this.setStatus('failed');
      this.result = { error: 'Could not find the schedule page.' };
      this.addLog('error', 'Failed to find schedule page.');
    }
  }

  async confirm() {
    if (this.status !== 'active') return;
    // User has logged in — now let the AI find and collect the schedule
    this.findSchedule().catch((err) => {
      this.setStatus('failed');
      this.result = { error: err.message };
      this.addLog('error', `Unexpected error: ${err.message}`);
    });
  }

  async collectScheduleData(navigator) {
    this.setStatus('extracting');
    this.addLog('action', 'Schedule page found. Collecting full schedule...');

    const entries = await navigator.collectSchedule(this.page, (step) => {
      this.aiLog.push(step);
      this.emitEvent('log', step);
    });

    let screenshotBase64 = null;
    try {
      const buf = await this.page.screenshot({ type: 'jpeg', quality: 75 });
      screenshotBase64 = buf.toString('base64');
    } catch {}

    this.result = {
      scheduleFound: entries.length > 0,
      scheduleJson: entries,
      screenshotBase64,
      debug: {
        scheduleUrl: this.currentUrl,
        scheduleTitle: this.pageTitle,
      },
    };

    this.setStatus(entries.length > 0 ? 'success' : 'failed');
    this.addLog(
      entries.length > 0 ? 'action' : 'error',
      entries.length > 0
        ? `Collected ${entries.length} schedule entries.`
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
