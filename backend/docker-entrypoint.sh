#!/usr/bin/env bash
set -e

# Start Xvfb on display :99
Xvfb :99 -screen 0 1280x800x24 &
export DISPLAY=:99

# Wait for Xvfb to be ready
sleep 1

# Start x11vnc (VNC server on port 5900)
x11vnc -display :99 -forever -nopw -rfbport 5900 -quiet &

# Start websockify to bridge VNC → WebSocket on port 6080
websockify --web /usr/share/novnc/ 6080 localhost:5900 &

echo "Xvfb, x11vnc, and noVNC started."

# Start the Spring Boot application
exec java \
    -Djava.awt.headless=true \
    -jar /app/app.jar
