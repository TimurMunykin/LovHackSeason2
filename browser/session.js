const { chromium } = require('playwright');
const express = require('express');

const app = express();
app.use(express.json());

let browser = null;
let page = null;
let status = 'idle';
let currentUrl = '';
let detectedTitle = '';

app.post('/start', async (req, res) => {
  if (browser) {
    return res.json({ status, url: currentUrl });
  }

  status = 'starting';
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
    status = 'active';
    currentUrl = targetUrl;
    detectedTitle = await page.title();

    page.on('framenavigated', async (frame) => {
      if (frame === page.mainFrame()) {
        currentUrl = frame.url();
        try {
          detectedTitle = await page.title();
        } catch {}
        checkAuthSuccess(currentUrl);
      }
    });

    browser.on('disconnected', () => {
      status = status === 'success' ? 'success' : 'failed';
      browser = null;
      page = null;
    });

    res.json({ status: 'started', url: currentUrl });
  } catch (err) {
    status = 'failed';
    console.error('Launch error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

const SUCCESS_PATTERNS = [
  /dashboard/i,
  /portal/i,
  /my[\-_]?account/i,
  /success/i,
  /welcome/i,
  /main.*page/i,
  /student/i,
];

function checkAuthSuccess(url) {
  if (SUCCESS_PATTERNS.some((p) => p.test(url))) {
    status = 'success';
  }
}

app.get('/status', async (req, res) => {
  let title = detectedTitle;
  if (page && status === 'active') {
    try {
      title = await page.title();
      detectedTitle = title;
    } catch {}
  }
  res.json({ status, url: currentUrl, title });
});

app.post('/confirm', (req, res) => {
  status = 'success';
  res.json({ status: 'success' });
});

app.post('/stop', async (req, res) => {
  if (browser) {
    try {
      await browser.close();
    } catch {}
    browser = null;
    page = null;
  }
  status = 'idle';
  currentUrl = '';
  detectedTitle = '';
  res.json({ status: 'idle' });
});

app.listen(3001, () => console.log('Session manager listening on port 3001'));
