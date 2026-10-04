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
        '{"supports":["qris","va","card"],"coming_soon":true}'::jsonb
    )
ON CONFLICT (provider) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    updated_at = now();
