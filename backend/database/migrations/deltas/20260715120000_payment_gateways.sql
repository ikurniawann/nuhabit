-- Multi-provider payment gateway configuration (Xendit first, Midtrans later)
CREATE TABLE IF NOT EXISTS configuration.payment_gateways (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    provider text NOT NULL,
    display_name text NOT NULL,
    is_active boolean NOT NULL DEFAULT false,
    environment text NOT NULL DEFAULT 'sandbox'
        CHECK (environment = ANY (ARRAY['sandbox'::text, 'live'::text])),
    secret_key text,
    public_key text,
    webhook_secret text,
    callback_url text,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    updated_by uuid,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT payment_gateways_provider_key UNIQUE (provider),
    CONSTRAINT payment_gateways_provider_check
        CHECK (provider = ANY (ARRAY['xendit'::text, 'midtrans'::text]))
);

CREATE INDEX IF NOT EXISTS idx_payment_gateways_active
    ON configuration.payment_gateways (is_active, provider);

COMMENT ON TABLE configuration.payment_gateways IS
  'Payment gateway provider settings (Xendit, Midtrans). Secrets masked in API responses.';

INSERT INTO configuration.payment_gateways (
    id, provider, display_name, is_active, environment, metadata
) VALUES
    (
        'b0000000-0000-4000-8000-000000000001',
        'xendit',
        'Xendit',
        false,
        'sandbox',
        '{"supports":["qris","va","ewallet"],"docs":"https://developers.xendit.co"}'::jsonb
    ),
    (
        'b0000000-0000-4000-8000-000000000002',
        'midtrans',
        'Midtrans',
        false,
        'sandbox',
        '{"supports":["qris","va","card"],"coming_soon":true}'::jsonb
    )
ON CONFLICT (provider) DO NOTHING;
