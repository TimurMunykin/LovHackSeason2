const { chromium } = require('playwright');
const express = require('express');
const { AiNavigator } = require('./ai-navigator');
const { extractSchedule } = require('./schedule-extractor');

const app = express();
app.use(express.json());

let browser = null;
let page = null;
let context = null;
let status = 'idle'; // idle | starting | navigating_login | active | navigating_schedule | extracting | success | failed
let currentUrl = '';
let detectedTitle = '';
let aiLog = [];
let navigator = null;
let networkLog = [];
let result = createEmptyResult();

function createEmptyResult() {
  return {
    scheduleFound: false,
    screenshotBase64: '',
    extractionSource: '',
    scheduleJson: null,
    debug: {},
    error: '',
  };
}

function resetRunState() {
  aiLog = [];
  networkLog = [];
  result = createEmptyResult();
}

function logStep(step) {
  console.log(step.message);
  aiLog.push(step);
}

function attachPageListeners(targetPage) {
  targetPage.on('framenavigated', async (frame) => {
    if (frame === targetPage.mainFrame()) {
      currentUrl = frame.url();
      try {
        detectedTitle = await targetPage.title();
      } catch {}
      if (status === 'active') checkAuthSuccess(currentUrl);
    }
  });

  targetPage.on('response', async (response) => {
    if (status !== 'navigating_schedule' && status !== 'extracting') return;

    try {
      const headers = response.headers();
      const contentType = headers['content-type'] || '';
      const url = response.url();
      if (!/json|javascript|text|html/i.test(contentType) && !/(schedule|timetable|calendar|lesson|class|subject|raspis|распис|занят)/i.test(url)) {
        return;
      }

      const bodyText = await response.text();
      if (!bodyText || bodyText.length > 300000) return;

      let json = null;
      try {
        json = JSON.parse(bodyText);
      } catch {}

      networkLog.push({
        url,
        status: response.status(),
        contentType,
        json,
        textSample: bodyText.slice(0, 2000),
      });
    } catch {}
  });
}

app.post('/start', async (req, res) => {
  if (browser) {
    return res.json({ status, url: currentUrl, title: detectedTitle, aiLog, result });
  }

  status = 'starting';
  resetRunState();
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

    context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    });

    page = await context.newPage();
    attachPageListeners(page);
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    currentUrl = targetUrl;
    detectedTitle = await page.title();

    browser.on('disconnected', () => {
      if (status !== 'success' && status !== 'idle') status = 'failed';
      browser = null;
      page = null;
      context = null;
      navigator = null;
    });

    status = 'navigating_login';
    res.json({ status, url: currentUrl, title: detectedTitle, aiLog, result });

    runNavigation('login');
  } catch (err) {
    status = 'failed';
    result.error = err.message;
    console.error('Launch error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

async function runNavigation(goalName) {
  navigator = new AiNavigator();

  const resultNav = await navigator.navigate(page, goalName, logStep);
  navigator = null;
  if (!browser || !page) return;

  if (goalName === 'login') {
    if (resultNav.success) {
      aiLog.push({ phase: 'handoff', message: 'Login page found - your turn! Complete login and 2FA below, then click the confirm button.' });
    } else {
      aiLog.push({ phase: 'handoff', message: `AI could not find the login page: ${resultNav.reason}. You can navigate manually, then click the confirm button.` });
    }
    status = 'active';
    return;
  }

  if (goalName === 'schedule') {
    if (!resultNav.success) {
      status = 'failed';
      result.error = `Schedule page not found: ${resultNav.reason}`;
      aiLog.push({ phase: 'error', message: result.error });
      return;
    }

    result.scheduleFound = true;
    result.debug.scheduleUrl = currentUrl;
    result.debug.scheduleTitle = detectedTitle;
    result.screenshotBase64 = (await page.screenshot({ type: 'jpeg', quality: 75, fullPage: true })).toString('base64');
    aiLog.push({ phase: 'handoff', message: 'Schedule page found. Saved a debug screenshot and starting data extraction...' });

    status = 'extracting';
    await runExtraction();
  }
}

async function runExtraction() {
  if (!page) return;

  try {
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    const extracted = await extractSchedule(page, networkLog);

    if (!extracted) {
      status = 'failed';
      result.error = 'Schedule page found, but no structured schedule data could be extracted from network or DOM.';
      aiLog.push({ phase: 'error', message: result.error });
      return;
    }

    result.extractionSource = extracted.source;
    result.scheduleJson = extracted.items;
    result.debug = { ...result.debug, ...extracted.debug };
    aiLog.push({ phase: 'handoff', message: `Extraction complete via ${extracted.source}. Found ${extracted.items.length} schedule entries.` });
    status = 'success';
  } catch (err) {
    status = 'failed';
    result.error = `Extraction failed: ${err.message}`;
    aiLog.push({ phase: 'error', message: result.error });
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
    status = 'active';
  }
}

app.get('/status', async (req, res) => {
  let title = detectedTitle;
  if (page && status !== 'idle' && status !== 'failed') {
    try {
      title = await page.title();
      detectedTitle = title;
    } catch {}
  }

  res.json({ status, url: currentUrl, title, aiLog, result });
});

app.post('/confirm', (req, res) => {
  if (!page || !browser) {
    return res.status(400).json({ error: 'No active browser session' });
  }

  networkLog = [];
  status = 'navigating_schedule';
  aiLog.push({ phase: 'handoff', message: 'Login confirmed. AI is now searching for the schedule page...' });
  res.json({ status });
  runNavigation('schedule');
});

app.post('/stop', async (req, res) => {
  if (navigator) navigator.stop();
  if (browser) {
    try {
      await browser.close();
    } catch {}
  }

  browser = null;
  page = null;
  context = null;
  navigator = null;
  status = 'idle';
  currentUrl = '';
  detectedTitle = '';
  resetRunState();
  res.json({ status: 'idle' });
});

app.listen(3001, () => console.log('Session manager listening on port 3001'));
