-- Audit trail of Do turns. Next (lib/assistant/session-store.ts) and the Go
-- API (insights.persistAndAudit) insert one row per turn and the summary
-- reads the latest rows, but the table was never created, so every insert
-- failed silently. The columns match those inserts.
CREATE TABLE IF NOT EXISTS public.ai_assistant_logs (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    user_email  text,
    prompt      text,
    intent      text,
    mode        text,
    model       text,
    latency_ms  integer,
    error       text,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_assistant_logs_created
    ON public.ai_assistant_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_assistant_logs_user
    ON public.ai_assistant_logs (user_id, created_at DESC);
