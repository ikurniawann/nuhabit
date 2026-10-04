-- Fix order status dan total_amount untuk order yang sudah ada
-- Run ini di psql atau SQL client

-- Update status ke 'completed' dan payment_status ke 'paid' untuk semua order
UPDATE pos_orders 
SET 
  status = 'completed',
  payment_status = 'paid',
  -- Set total_amount berdasarkan amount_paid jika total_amount = 0
  total_amount = CASE 
    WHEN total_amount = 0 OR total_amount IS NULL THEN amount_paid 
    ELSE total_amount 
  END
WHERE status = 'pending';

-- Verify update
SELECT 
  order_number,
  status,
  payment_status,
  total_amount,
  amount_paid,
  customer_id
FROM pos_orders 
ORDER BY ordered_at DESC 
LIMIT 10;
