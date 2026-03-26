const { BrowserSession } = require('./browser-session');

const BASE_DISPLAY = 100; // displays start at :100, ports at 6180

class SessionManager {
  constructor() {
    this.sessions = new Map();
    this.nextDisplay = BASE_DISPLAY;
  }

  async create(sessionId, url) {
    if (this.sessions.has(sessionId)) {
      const existing = this.sessions.get(sessionId);
      await existing.stop();
      this.sessions.delete(sessionId);
    }

    const displayNum = this.nextDisplay++;
    const session = new BrowserSession(sessionId, displayNum);
    this.sessions.set(sessionId, session);
    await session.start(url);
    return session;
  }

  get(sessionId) {
    return this.sessions.get(sessionId) || null;
  }

  has(sessionId) {
    return this.sessions.has(sessionId);
  }

  async destroy(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    await session.stop();
    this.sessions.delete(sessionId);
  }
}

module.exports = { SessionManager };
