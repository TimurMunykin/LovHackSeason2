const http = require('http');
const net = require('net');
const express = require('express');
const { WebSocketServer, WebSocket } = require('ws');
const { SessionManager } = require('./session-manager');

const app = express();
const PORT = process.env.PORT || 3001;
const manager = new SessionManager();

app.use(express.json());

// Serve noVNC static files
app.use('/novnc', express.static('/usr/share/novnc'));

app.post('/sessions', async (req, res) => {
  const { sessionId, url } = req.body;
  if (!sessionId || !url) return res.status(400).json({ error: 'sessionId and url are required' });

  try {
    const session = await manager.create(sessionId, url);
    res.json({ sessionId, status: session.status });
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

// Create HTTP server for WebSocket upgrade support
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const match = req.url.match(/^\/vnc-ws\/(.+?)(\?|$)/);
  if (!match) {
    socket.destroy();
    return;
  }

  const sessionId = match[1];
  const session = manager.get(sessionId);
  if (!session) {
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    // Connect to x11vnc via raw TCP
    const vnc = net.connect(session.vncPort, 'localhost');

    vnc.on('connect', () => {
      ws.on('message', (data) => {
        if (vnc.writable) vnc.write(Buffer.isBuffer(data) ? data : Buffer.from(data));
      });

      vnc.on('data', (data) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(data);
      });
    });

    ws.on('close', () => vnc.destroy());
    vnc.on('close', () => ws.close());
    vnc.on('error', () => ws.close());
    ws.on('error', () => vnc.destroy());
  });
});

server.listen(PORT, () => {
  console.log(`Browser service listening on port ${PORT}`);
});
