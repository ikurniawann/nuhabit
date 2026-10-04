-- Repair purchase_order_items.qty_received from sum of active GRN item quantities.
-- Fixes rows corrupted by JS string concatenation (e.g. "0.0000" + 50 -> 0.0001).

UPDATE purchasing.purchase_order_items poi
SET
  qty_received = sub.total_received,
  updated_at = NOW()
FROM (
  SELECT
    gi.purchase_order_item_id,
    COALESCE(SUM(gi.qty_diterima), 0::numeric) AS total_received
  FROM purchasing.grn_items gi
  INNER JOIN purchasing.grn g ON g.id = gi.grn_id AND g.is_active = true
  WHERE gi.purchase_order_item_id IS NOT NULL
    AND gi.is_active = true
  GROUP BY gi.purchase_order_item_id
) sub
WHERE poi.id = sub.purchase_order_item_id
  AND poi.qty_received IS DISTINCT FROM sub.total_received;
