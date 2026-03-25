#!/bin/bash
set -e

# Start virtual framebuffer
Xvfb :99 -screen 0 1280x800x24 -ac +extension GLX +render -noreset &
XVFB_PID=$!
sleep 1

export DISPLAY=:99

# Start VNC server (no password, shared mode)
x11vnc -display :99 -nopw -forever -shared -rfbport 5900 -xkb &
sleep 1

# Start noVNC via websockify
websockify --web /usr/share/novnc 6080 localhost:5900 &

echo "Remote browser ready: VNC on :5900, noVNC on :6080"

# Start Playwright session manager
exec node session.js
