-- Backfill company_id/branch_id pada PO yang dibuat dari PR tanpa scope.
UPDATE purchasing.purchase_orders po
SET
  company_id = COALESCE(po.company_id, pr.company_id),
  branch_id = COALESCE(po.branch_id, pr.branch_id),
  updated_at = now()
FROM purchasing.purchase_requests pr
WHERE po.pr_id = pr.id
  AND (po.company_id IS NULL OR po.branch_id IS NULL)
  AND (pr.company_id IS NOT NULL OR pr.branch_id IS NOT NULL);
