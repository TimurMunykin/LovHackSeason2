const { Router } = require('express');

const router = Router();
const BROWSER_API = process.env.BROWSER_API || 'http://browser:3001';
// In dev: http://localhost:3001, in prod: empty (same origin via Caddy)
const BROWSER_PUBLIC_URL = process.env.BROWSER_PUBLIC_URL || '';

async function proxy(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const resp = await fetch(`${BROWSER_API}${path}`, opts);
  return resp.json();
}

function buildVncUrl(sessionId) {
  const vncPath = 'vnc_lite.html?autoconnect=true&resize=scale&reconnect=true&reconnect_delay=1000';
  return `${BROWSER_PUBLIC_URL}/novnc/${vncPath}&path=vnc-ws/${sessionId}`;
}

router.post('/start', async (req, res) => {
  try {
    const data = await proxy('POST', '/sessions', {
      sessionId: req.user.id,
      url: req.body.url,
    });
    data.vncUrl = buildVncUrl(req.user.id);
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: 'Browser service unavailable', details: err.message });
  }
});

router.get('/status', async (req, res) => {
  try {
    const data = await proxy('GET', `/sessions/${req.user.id}`);
    data.vncUrl = buildVncUrl(req.user.id);
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: 'Browser service unavailable' });
  }
});

router.post('/confirm', async (req, res) => {
  try {
    const data = await proxy('POST', `/sessions/${req.user.id}/confirm`);
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: 'Browser service unavailable' });
  }
});

router.post('/stop', async (req, res) => {
  try {
    const data = await proxy('DELETE', `/sessions/${req.user.id}`);
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: 'Browser service unavailable' });
  }
});

router.get('/events', (req, res) => {
  const userId = req.user.id;
  const url = `${BROWSER_API}/sessions/${userId}/events`;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  const controller = new AbortController();

  fetch(url, { signal: controller.signal })
    .then(async (upstream) => {
      if (!upstream.ok) {
        res.write(`event: error\ndata: {"error":"Session not found"}\n\n`);
        res.end();
        return;
      }
      const reader = upstream.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(decoder.decode(value, { stream: true }));
      }
      res.end();
    })
    .catch(() => res.end());

  req.on('close', () => controller.abort());
});

module.exports = router;
