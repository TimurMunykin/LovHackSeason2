FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-venv \
    xvfb \
    x11vnc \
    novnc \
    websockify \
    && rm -rf /var/lib/apt/lists/*

RUN python3 -m venv /opt/sched-venv
ENV PATH="/opt/sched-venv/bin:$PATH"

WORKDIR /app

COPY package.json requirements-schedule.txt ./
RUN npm install \
    && pip install --no-cache-dir -r requirements-schedule.txt
RUN npx playwright install --with-deps chromium

COPY . .

CMD ["node", "server.js"]
