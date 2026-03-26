const express = require('express');
const { SessionManager } = require('./session-manager');

const app = express();
const PORT = process.env.PORT || 3001;
const manager = new SessionManager();

app.use(express.json());

app.post('/sessions', async (req, res) => {
  const { sessionId, url } = req.body;
  if (!sessionId || !url) return res.status(400).json({ error: 'sessionId and url are required' });

  try {
    const session = await manager.create(sessionId, url);
    res.json({ sessionId, status: session.status, vncPort: session.wsPort });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/sessions/:id', (req, res) => {
  const session = manager.get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  res.json(session.getStatus());
});

app.delete('/sessions/:id', async (req, res) => {
  await manager.destroy(req.params.id);
  res.json({ ok: true });
});

app.post('/sessions/:id/confirm', async (req, res) => {
  const session = manager.get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  session.confirm();
  res.json({ ok: true });
});

app.get('/sessions/:id/events', (req, res) => {
  const session = manager.get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  res.write(`event: status\ndata: ${JSON.stringify(session.getStatusPayload())}\n\n`);

  session.addSSEClient(res);
  req.on('close', () => session.removeSSEClient(res));
});

app.listen(PORT, () => {
  console.log(`Browser service listening on port ${PORT}`);
});
