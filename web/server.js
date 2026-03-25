const express = require('express');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const BROWSER_API = process.env.BROWSER_API || 'http://browser:3001';

async function proxyToBrowser(method, endpoint, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);
  const resp = await fetch(`${BROWSER_API}${endpoint}`, opts);
  return resp.json();
}

app.post('/api/session/start', async (req, res) => {
  try {
    const data = await proxyToBrowser('POST', '/start', { url: req.body.url });
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: 'Browser service unavailable', details: err.message });
  }
});

app.get('/api/session/status', async (req, res) => {
  try {
    const data = await proxyToBrowser('GET', '/status');
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: 'Browser service unavailable', status: 'unknown' });
  }
});

app.post('/api/session/confirm', async (req, res) => {
  try {
    const data = await proxyToBrowser('POST', '/confirm');
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: 'Browser service unavailable' });
  }
});

app.post('/api/session/stop', async (req, res) => {
  try {
    const data = await proxyToBrowser('POST', '/stop');
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: 'Browser service unavailable' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Web app listening on port ${PORT}`));
