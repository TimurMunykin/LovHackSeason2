const { chromium } = require('playwright');
const express = require('express');
const { AiNavigator } = require('./ai-navigator');

const app = express();
app.use(express.json());

let browser = null;
let page = null;
let status = 'idle'; // idle | starting | navigating | active | success | failed
let currentUrl = '';
let detectedTitle = '';
let aiLog = [];
let navigator = null;

app.post('/start', async (req, res) => {
  if (browser) {
    return res.json({ status, url: currentUrl });
  }

  status = 'starting';
  aiLog = [];
  const targetUrl = req.body.url || 'https://login.microsoftonline.com';

  try {
    browser = await chromium.launch({
      headless: false,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--window-size=1280,800',
      ],
    });

    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    });

    page = await context.newPage();
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    currentUrl = targetUrl;
    detectedTitle = await page.title();

    page.on('framenavigated', async (frame) => {
      if (frame === page.mainFrame()) {
        currentUrl = frame.url();
        try { detectedTitle = await page.title(); } catch {}
        if (status === 'active') checkAuthSuccess(currentUrl);
      }
    });

    browser.on('disconnected', () => {
      if (status !== 'success') status = 'failed';
      browser = null;
      page = null;
      navigator = null;
    });

    // Start AI navigation
    status = 'navigating';
    res.json({ status: 'navigating', url: currentUrl });

    runAiNavigation(page);
  } catch (err) {
    status = 'failed';
    console.error('Launch error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

async function runAiNavigation(page) {
  navigator = new AiNavigator();

  const result = await navigator.navigate(page, (step) => {
    console.log(step.message);
    aiLog.push(step);
  });

  navigator = null;

  if (!browser) return; // browser was closed during navigation

  if (result.success) {
    aiLog.push({ phase: 'handoff', message: 'Login page found — your turn! Complete login and 2FA below.' });
    status = 'active';
  } else {
    aiLog.push({ phase: 'handoff', message: `AI couldn't find login page: ${result.reason}. You can try navigating manually.` });
    status = 'active'; // still let user try manually
  }
}

const SUCCESS_PATTERNS = [
  /dashboard/i,
  /portal/i,
  /my[\-_]?account/i,
  /success/i,
  /welcome/i,
  /main.*page/i,
];

function checkAuthSuccess(url) {
  if (SUCCESS_PATTERNS.some((p) => p.test(url))) {
    status = 'success';
  }
}

app.get('/status', async (req, res) => {
  let title = detectedTitle;
  if (page && (status === 'active' || status === 'navigating')) {
    try {
      title = await page.title();
      detectedTitle = title;
    } catch {}
  }
  res.json({ status, url: currentUrl, title, aiLog });
});

app.post('/confirm', (req, res) => {
  status = 'success';
  res.json({ status: 'success' });
});

app.post('/stop', async (req, res) => {
  if (navigator) navigator.stop();
  if (browser) {
    try { await browser.close(); } catch {}
    browser = null;
    page = null;
  }
  navigator = null;
  status = 'idle';
  currentUrl = '';
  detectedTitle = '';
  aiLog = [];
  res.json({ status: 'idle' });
});

app.listen(3001, () => console.log('Session manager listening on port 3001'));
