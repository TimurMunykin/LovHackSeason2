# Plan: Browser Automation Service with Multi-Session Support

## Context
OAuth и фундамент готовы. Теперь добавляем ядро продукта: пользователь даёт URL университетского портала, AI-агент через Playwright находит расписание, при необходимости отдаёт управление пользователю для логина/2FA. Несколько пользователей должны работать одновременно с изолированными браузерными сессиями.

Вместо VNC (как было в PoC) — screenshot-based взаимодействие: скриншоты в UI, клик по координатам, ввод текста. Обновления через SSE.

## Архитектура

```
[Frontend dashboard.html]
    ↕ SSE + REST
[Web server :3000]  — auth, proxy
    ↕ fetch
[Browser service :3001]  — SessionManager → BrowserSession[]
    ↕ Playwright
[Headless Chromium instances]
    ↕ OpenAI Vision API
[AI Navigator]
```

## Новые/изменённые файлы

```
browser/                        # NEW — отдельный Docker-контейнер
  server.js                     # Express :3001, роуты сессий + SSE
  session-manager.js            # Map<sessionId, BrowserSession>
  browser-session.js            # Один юзер: browser, page, status, logs
  ai-navigator.js               # Vision LLM + screenshot loop
  schedule-extractor.js          # Network capture + DOM fallback
  package.json                   # express, playwright, openai
  Dockerfile                     # node:20-bookworm-slim + playwright chromium
  .dockerignore

web/
  routes/browser.js              # NEW — proxy к browser service (с auth)
  server.js                      # MODIFY — подключить browser routes
  views/dashboard.html           # MODIFY — полный UI с screenshot viewer

docker-compose.yml               # MODIFY — добавить browser service
docker-compose.dev.yml           # MODIFY — build + port для browser
docker-compose.prod.yml          # MODIFY — image для browser
build-release.sh                 # MODIFY — билдить и пушить browser image
.env.example                     # MODIFY — добавить OPENAI_API_KEY
```

## Browser Service API (внутренний, :3001)

| Method | Path | Body | Описание |
|--------|------|------|----------|
| POST | /sessions | `{sessionId, url}` | Создать сессию, запустить браузер, начать AI навигацию к логину |
| GET | /sessions/:id | — | Статус, url, title, aiLog, result |
| DELETE | /sessions/:id | — | Остановить, закрыть браузер |
| GET | /sessions/:id/screenshot | — | Текущий скриншот (base64 JPEG) |
| POST | /sessions/:id/click | `{x, y}` | Клик по координатам |
| POST | /sessions/:id/type | `{text}` | Ввод текста |
| POST | /sessions/:id/keypress | `{key}` | Нажать клавишу (Enter, Tab) |
| POST | /sessions/:id/confirm | — | Пользователь залогинился → AI ищет расписание |
| GET | /sessions/:id/events | — | SSE поток (status, screenshot, log) |

## Web Server Proxy API (с auth, :3000)

sessionId = req.user.id (один сеанс на юзера)

| Frontend | Proxies To |
|----------|-----------|
| POST /api/browser/start `{url}` | POST /sessions |
| GET /api/browser/status | GET /sessions/:userId |
| GET /api/browser/screenshot | GET /sessions/:userId/screenshot |
| POST /api/browser/click | POST /sessions/:userId/click |
| POST /api/browser/type | POST /sessions/:userId/type |
| POST /api/browser/keypress | POST /sessions/:userId/keypress |
| POST /api/browser/confirm | POST /sessions/:userId/confirm |
| POST /api/browser/stop | DELETE /sessions/:userId |
| GET /api/browser/events | SSE relay /sessions/:userId/events |

## BrowserSession — жизненный цикл

```
idle → starting → navigating_login → active (юзер логинится)
                                        ↓ confirm
                                  navigating_schedule → extracting → success/failed
```

Каждый BrowserSession содержит:
- browser, context, page (Playwright, headless)
- status, currentUrl, pageTitle
- aiLog[] — шаги AI навигатора
- networkLog[] — перехваченные ответы сети
- result — результат экстракции
- sseClients[] — подключённые SSE клиенты

## AI Navigator

- Vision LLM (OpenAI, модель из OPENAI_MODEL env, дефолт gpt-4o-mini)
- Цикл: screenshot → отправить в LLM → получить action JSON → выполнить
- Actions: click (по тексту), click_coords (x,y), done, fail
- Max 12 шагов на цель
- Два режима: login (найти форму входа), schedule (найти расписание)
- После каждого шага — emit screenshot + log через SSE

## Schedule Extractor

- **Network-first**: перехват JSON-ответов во время навигации, поиск массивов с полями расписания, scoring
- **DOM fallback**: парсинг `<table>`, элементы с class*="schedule", до 80 записей
- Нормализация: subject, date, day, time, room, teacher, type

## Dashboard UI

1. URL input + кнопка "Start"
2. Status bar (цветовой индикатор статуса)
3. Screenshot viewer — `<img>` с overlay для кликов, масштабирование координат (viewport 1280x800)
4. Input bar — текстовое поле + "Type" + "Enter" кнопки
5. AI log — scrollable лог шагов
6. Кнопки: "I've completed login" (при active), "Stop"
7. Results — таблица с извлечённым расписанием

SSE подключение: EventSource('/api/browser/events') для обновлений screenshot/status/log.

## Docker

Browser service Dockerfile (node:20-bookworm-slim, не alpine — Playwright нужен glibc):
```dockerfile
FROM node:20-bookworm-slim
WORKDIR /app
COPY package.json ./
RUN npm install
RUN npx playwright install --with-deps chromium
COPY . .
CMD ["node", "server.js"]
```

docker-compose.yml — добавить browser service с shm_size: "2g" и OPENAI_API_KEY.
Web service — добавить BROWSER_API=http://browser:3001.

build-release.sh — добавить сборку и пуш lovhack-browser image.

## Env vars (новые)

```
OPENAI_API_KEY=          # обязательно
OPENAI_MODEL=gpt-4o-mini # опционально
```

## Порядок реализации

1. browser/package.json + Dockerfile + .dockerignore
2. browser/browser-session.js — класс сессии (start, stop, screenshot, click, type, keypress, SSE)
3. browser/session-manager.js — менеджер сессий
4. browser/server.js — Express с роутами
5. browser/ai-navigator.js — AI навигатор
6. browser/schedule-extractor.js — экстрактор расписания
7. web/routes/browser.js — прокси-роуты с auth
8. web/server.js — подключить browser routes
9. web/views/dashboard.html — полный UI
10. docker-compose.yml + dev + prod — добавить browser service
11. build-release.sh — добавить browser image
12. .env.example — добавить OPENAI_API_KEY

## Верификация

1. `./dev.sh` → все контейнеры (web + postgres + browser) поднялись
2. Логин через Google → дашборд с URL input
3. Ввести URL университета → AI начинает навигацию, скриншоты обновляются в реальном времени
4. AI находит логин → статус "active", видны поля для ввода
5. Кликнуть по screenshot, ввести текст → отображается в браузере
6. Нажать "I've completed login" → AI ищет расписание
7. Расписание найдено → таблица с данными
8. Два юзера одновременно → изолированные сессии
