-- Ensure default payment gateway providers exist
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
        '{"supports":["qris","gopay","shopeepay","va","card"],"docs":"https://docs.midtrans.com"}'::jsonb
    )
ON CONFLICT (provider) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    metadata = (configuration.payment_gateways.metadata - 'coming_soon') || EXCLUDED.metadata,
    updated_at = now();
