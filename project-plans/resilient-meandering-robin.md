# Plan: App Foundation on Master

## Context
PoC ветка подтвердила теорию. Теперь на master строим фундамент приложения с нуля — лендинг, Google OAuth, профиль, PostgreSQL. Код из PoC не берём, интегрируем позже.

## Стек
- Frontend: Vanilla HTML/CSS/JS + Tailwind (CDN)
- Backend: Node.js / Express
- DB: PostgreSQL + Prisma
- Auth: Google OAuth 2.0 (passport)
- Infra: Docker Compose, Caddy (prod)

## Структура файлов

```
web/
  server.js                  # Express: session, passport, static, routes
  package.json               # express, passport, passport-google-oauth20,
                             #   express-session, connect-pg-simple, @prisma/client
  Dockerfile                 # Node 20 alpine + prisma generate
  docker-entrypoint.sh       # prisma migrate deploy → node server.js
  .dockerignore
  prisma/
    schema.prisma            # User model
  routes/
    auth.js                  # Passport Google strategy + auth routes
  middleware/
    auth.js                  # requireAuth middleware
  public/
    index.html               # Лендинг (Tailwind CDN, CTA "Sign in with Google")
  views/
    dashboard.html           # Защищённая страница, fetch /auth/me для данных

Caddyfile                    # Single domain → web:3000
docker-compose.yml           # Base: web + postgres (без build/image)
docker-compose.dev.yml       # Dev: build local, ports 3000+5432
docker-compose.prod.yml      # Prod: Docker Hub images, caddy, HTTPS

dev.sh                       # docker compose -f base -f dev up --build
build-release.sh             # docker build + push to Docker Hub
deploy.sh                    # docker compose -f base -f prod pull + up -d

.env.example
.gitignore
README.md
```

## Prisma Schema

```prisma
model User {
  id        String   @id @default(cuid())
  googleId  String   @unique
  email     String   @unique
  name      String
  avatarUrl String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

Сессии — через `connect-pg-simple` (createTableIfMissing: true), без Prisma модели.

## Auth Flow

- `GET /auth/google` → redirect to Google OAuth
- `GET /auth/google/callback` → create/find user, set session → redirect /dashboard
- `GET /auth/logout` → destroy session → redirect /
- `GET /auth/me` → JSON с данными пользователя (для dashboard fetch)
- `requireAuth` middleware на /dashboard

BASE_URL из env для callback URL (localhost:3000 в dev, https://domain в prod).

## Docker Compose (3 файла)

**Base** — web + postgres, shared env, depends_on с healthcheck. Без build/image/ports.

**Dev** — build: ./web, ports 3000 + 5432, NODE_ENV=development, pgdata volume.

**Prod** — image из Docker Hub, caddy service, NODE_ENV=production, pgdata + caddy volumes.

## 3 скрипта

**dev.sh**: source .env, defaults для POSTGRES_PASSWORD/SESSION_SECRET, BASE_URL=http://localhost:3000, compose down + up --build foreground. Флаги: NO_CACHE, RESET_VOLUMES.

**build-release.sh**: source .env, validate DOCKER_REPO_PREFIX, tag = git short SHA + latest, docker build + push.

**deploy.sh**: source .env, validate все prod vars, BASE_URL=https://$APP_DOMAIN, compose pull + down + up -d. Флаг: RESET_VOLUMES.

## Env vars (.env.example)

```
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
SESSION_SECRET=change-me
POSTGRES_PASSWORD=change-me
DOCKER_REPO_PREFIX=yourdockerhubuser
APP_DOMAIN=your-domain.com
IMAGE_TAG=latest
```

## Шаги реализации

1. web/prisma/schema.prisma + web/package.json
2. web/routes/auth.js + web/middleware/auth.js
3. web/server.js
4. web/public/index.html + web/views/dashboard.html
5. web/Dockerfile + web/docker-entrypoint.sh + web/.dockerignore
6. docker-compose.yml + docker-compose.dev.yml + docker-compose.prod.yml + Caddyfile
7. dev.sh + build-release.sh + deploy.sh
8. .env.example + .gitignore + README.md
9. Запуск → prisma migrate dev --name init (генерация миграции)

## Верификация

1. `./dev.sh` → контейнеры собрались, app на localhost:3000
2. Кнопка "Sign in with Google" → OAuth flow → dashboard с именем/аватаром
3. /dashboard без авторизации → редирект на /
4. Logout → обратно на лендинг
5. `./build-release.sh` → образы в Docker Hub
6. На VPS: `./deploy.sh` → HTTPS работает
