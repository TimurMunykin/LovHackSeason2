CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE sessions (
    id           UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    status       VARCHAR(32) NOT NULL,
    url          TEXT        NOT NULL,
    current_url  TEXT,
    current_title TEXT,
    ai_log       JSONB,
    result       JSONB,
    error_message TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at   TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 minutes')
);

CREATE INDEX idx_sessions_status    ON sessions (status);
CREATE INDEX idx_sessions_expires_at ON sessions (expires_at);
