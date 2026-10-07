-- Isi company_id/branch_id PR dari profil requester bila masih kosong.
UPDATE purchasing.purchase_requests pr
SET
  company_id = COALESCE(pr.company_id, u.company_id),
  branch_id = COALESCE(pr.branch_id, u.branch_id),
  updated_at = now()
FROM configuration.users u
WHERE pr.requester_id = u.id
  AND (pr.company_id IS NULL OR pr.branch_id IS NULL)
  AND (u.company_id IS NOT NULL OR u.branch_id IS NOT NULL);
