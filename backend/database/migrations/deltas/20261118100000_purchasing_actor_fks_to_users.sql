-- =============================================================================
-- vendor_credits and purchase_returns created_by / approved_by, and
-- purchase_orders.closed_by, point at users.
--
-- The five foreign keys still referenced hris.staff, the legacy staff table,
-- while the application writes the session user's id (as it does on grn,
-- purchase_orders and the rest of purchasing). For any user without a staff
-- row of the same id the write failed: the automatic reject credit of a GRN
-- was skipped (its error is logged and swallowed), and closing a purchase
-- order, approving a vendor credit or rejecting a purchase return answered an
-- error.
--
-- NOT VALID keeps the legacy rows whose value is a staff id: Postgres checks
-- the constraint on new writes only. Idempotent.
-- =============================================================================

ALTER TABLE purchasing.vendor_credits DROP CONSTRAINT IF EXISTS vendor_credits_created_by_fkey;
ALTER TABLE purchasing.vendor_credits DROP CONSTRAINT IF EXISTS vendor_credits_approved_by_fkey;
ALTER TABLE purchasing.purchase_returns DROP CONSTRAINT IF EXISTS purchase_returns_created_by_fkey;
ALTER TABLE purchasing.purchase_returns DROP CONSTRAINT IF EXISTS purchase_returns_approved_by_fkey;
ALTER TABLE purchasing.purchase_orders DROP CONSTRAINT IF EXISTS purchase_orders_closed_by_fkey;

ALTER TABLE purchasing.vendor_credits
  ADD CONSTRAINT vendor_credits_created_by_fkey FOREIGN KEY (created_by) REFERENCES configuration.users(id) ON DELETE SET NULL NOT VALID;
ALTER TABLE purchasing.vendor_credits
  ADD CONSTRAINT vendor_credits_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES configuration.users(id) ON DELETE SET NULL NOT VALID;
ALTER TABLE purchasing.purchase_returns
  ADD CONSTRAINT purchase_returns_created_by_fkey FOREIGN KEY (created_by) REFERENCES configuration.users(id) ON DELETE SET NULL NOT VALID;
ALTER TABLE purchasing.purchase_returns
  ADD CONSTRAINT purchase_returns_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES configuration.users(id) ON DELETE SET NULL NOT VALID;
ALTER TABLE purchasing.purchase_orders
  ADD CONSTRAINT purchase_orders_closed_by_fkey FOREIGN KEY (closed_by) REFERENCES configuration.users(id) ON DELETE SET NULL NOT VALID;
