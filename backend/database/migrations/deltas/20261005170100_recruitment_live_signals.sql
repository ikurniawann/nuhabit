-- WebRTC signaling for live monitoring (backend/internal/modules/recruitment):
-- HR posts an SDP offer, the candidate portal polls pending offers and posts
-- an answer, HR polls the answer. The TS route kept these in one process's
-- memory, so HR and candidate had to hit the same instance; in a table any
-- API replica serves either side. Rows live two minutes, at most three
-- offers per session; writers delete expired rows.
CREATE TABLE IF NOT EXISTS recruitment.live_signals (
  id           bigserial PRIMARY KEY,
  session_type text NOT NULL CHECK (session_type IN ('psikotes', 'interview')),
  session_id   uuid NOT NULL,
  offer_id     text NOT NULL,
  offer_sdp    text NOT NULL,
  answer_sdp   text,
  created_at   timestamptz NOT NULL,
  UNIQUE (session_type, session_id, offer_id)
);

CREATE INDEX IF NOT EXISTS live_signals_created_idx ON recruitment.live_signals (created_at);

COMMENT ON TABLE recruitment.live_signals IS
  'Live monitoring WebRTC offers/answers (2-minute TTL), shared by every API replica.';
