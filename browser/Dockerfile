FROM node:20-bookworm

RUN apt-get update && apt-get install -y \
    xvfb \
    x11vnc \
    novnc \
    websockify \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
RUN npm install
RUN npx playwright install --with-deps chromium

COPY . .
RUN chmod +x start.sh

ENV DISPLAY=:99

CMD ["bash", "start.sh"]
