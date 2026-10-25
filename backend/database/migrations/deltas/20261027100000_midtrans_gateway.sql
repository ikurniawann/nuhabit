-- Midtrans is a selectable payment gateway next to Xendit (MOM item 7).
-- The row loses its coming_soon placeholder flag; merchant_id lives in
-- metadata (metadata->>'merchant_id'). Server key = secret_key, client key =
-- public_key. At most one gateway is active at a time (the settings API
-- deactivates the other on activation).
UPDATE configuration.payment_gateways
   SET metadata = (metadata - 'coming_soon')
                  || '{"supports":["qris","gopay","shopeepay","va","card"],"docs":"https://docs.midtrans.com"}'::jsonb,
       updated_at = now()
 WHERE provider = 'midtrans';
