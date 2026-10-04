-- EPIC-017 Fase E: aksi menulis Do wajib lewat konfirmasi eksplisit user.
-- Tabel ini adalah SATU-SATUNYA jalur aksi tulis dari asisten sekaligus
-- jejak auditnya: siapa & kapan mengusulkan (user_id + created_at), siapa &
-- kapan memutuskan (decided_by + decided_at), dan kapan dieksekusi
-- (executed_at + result). Baris pending yang tidak dikonfirmasi kedaluwarsa
-- lewat TTL yang ditegakkan endpoint konfirmasi.

CREATE TABLE IF NOT EXISTS public.ai_assistant_actions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id   uuid REFERENCES public.ai_assistant_sessions(id) ON DELETE SET NULL,
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action_name  text NOT NULL,
  payload      jsonb NOT NULL,
  summary      text NOT NULL,
  status       text NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'confirmed', 'cancelled', 'expired', 'failed')),
  result       jsonb,
  error        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  decided_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_at   timestamptz,
  executed_at  timestamptz
);

CREATE INDEX IF NOT EXISTS idx_ai_assistant_actions_user_status
  ON public.ai_assistant_actions (user_id, status, created_at DESC);
