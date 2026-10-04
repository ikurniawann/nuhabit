-- Tema Appearance per company (base / sidebar / navbar / font)
CREATE TABLE IF NOT EXISTS configuration.company_appearance (
  company_id uuid PRIMARY KEY REFERENCES configuration.companies(id) ON DELETE CASCADE,
  theme jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

CREATE INDEX IF NOT EXISTS idx_company_appearance_updated_at
  ON configuration.company_appearance (updated_at DESC);
