-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — triggers
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:30:14.389Z
-- =============================================================================

CREATE TRIGGER trg_menus_bump_version BEFORE UPDATE ON iam.menus FOR EACH ROW EXECUTE FUNCTION iam.menus_bump_version();
CREATE TRIGGER trg_menus_set_level BEFORE INSERT OR UPDATE OF parent_id ON iam.menus FOR EACH ROW EXECUTE FUNCTION iam.menus_set_level();
CREATE TRIGGER attendance_calculate_work_hours BEFORE INSERT OR UPDATE ON attendance FOR EACH ROW EXECUTE FUNCTION calculate_work_hours();
CREATE TRIGGER attendance_updated_at BEFORE UPDATE ON attendance FOR EACH ROW EXECUTE FUNCTION update_hris_updated_at();
CREATE TRIGGER trg_notify_attendance_changes AFTER INSERT OR DELETE OR UPDATE ON attendance FOR EACH ROW EXECUTE FUNCTION fn_notify_attendance_changes();
CREATE TRIGGER update_bom_items_updated_at BEFORE UPDATE ON bom_items FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_notify_candidate_changes AFTER INSERT OR DELETE OR UPDATE ON candidates FOR EACH ROW EXECUTE FUNCTION fn_notify_candidate_changes();
CREATE TRIGGER update_cogs_updated_at BEFORE UPDATE ON cogs_additional_costs FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER crm_collectible_avatars_set_updated_at BEFORE UPDATE ON crm_collectible_avatars FOR EACH ROW EXECUTE FUNCTION crm_set_updated_at();
CREATE TRIGGER crm_external_events_set_updated_at BEFORE UPDATE ON crm_external_events FOR EACH ROW EXECUTE FUNCTION crm_set_updated_at();
CREATE TRIGGER crm_integration_partners_set_updated_at BEFORE UPDATE ON crm_integration_partners FOR EACH ROW EXECUTE FUNCTION crm_set_updated_at();
CREATE TRIGGER crm_member_profiles_set_updated_at BEFORE UPDATE ON crm_member_profiles FOR EACH ROW EXECUTE FUNCTION crm_set_updated_at();
CREATE TRIGGER crm_membership_tiers_set_updated_at BEFORE UPDATE ON crm_membership_tiers FOR EACH ROW EXECUTE FUNCTION crm_set_updated_at();
CREATE TRIGGER crm_redemptions_set_updated_at BEFORE UPDATE ON crm_redemptions FOR EACH ROW EXECUTE FUNCTION crm_set_updated_at();
CREATE TRIGGER crm_rewards_set_updated_at BEFORE UPDATE ON crm_rewards FOR EACH ROW EXECUTE FUNCTION crm_set_updated_at();
CREATE TRIGGER crm_xp_rules_set_updated_at BEFORE UPDATE ON crm_xp_rules FOR EACH ROW EXECUTE FUNCTION crm_set_updated_at();
CREATE TRIGGER update_deliveries_updated_at BEFORE UPDATE ON deliveries FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_notify_document_changes AFTER INSERT OR DELETE ON employee_documents FOR EACH ROW EXECUTE FUNCTION fn_notify_document_changes();
CREATE TRIGGER employee_schedules_updated_at BEFORE UPDATE ON employee_schedules FOR EACH ROW EXECUTE FUNCTION update_hris_updated_at();
CREATE TRIGGER employees_generate_onboarding AFTER INSERT ON employees FOR EACH ROW EXECUTE FUNCTION generate_onboarding_checklist();
CREATE TRIGGER employees_updated_at BEFORE UPDATE ON employees FOR EACH ROW EXECUTE FUNCTION update_employees_updated_at();
CREATE TRIGGER on_employee_create_init_leave_balance AFTER INSERT ON employees FOR EACH ROW EXECUTE FUNCTION initialize_employee_leave_balance();
CREATE TRIGGER trg_notify_employee_changes AFTER INSERT OR DELETE OR UPDATE ON employees FOR EACH ROW EXECUTE FUNCTION fn_notify_employee_changes();
CREATE TRIGGER trg_record_employee_hire AFTER INSERT ON employees FOR EACH ROW EXECUTE FUNCTION fn_record_employee_hire();
CREATE TRIGGER trg_lock_summary_on_approval AFTER UPDATE ON feedback_assignments FOR EACH ROW WHEN (old.status::text IS DISTINCT FROM new.status::text) EXECUTE FUNCTION trg_lock_summary_on_approval();
CREATE TRIGGER trg_calculate_feedback_summary AFTER INSERT OR UPDATE ON feedback_responses FOR EACH ROW EXECUTE FUNCTION fn_calculate_feedback_summary();
CREATE TRIGGER update_grn_updated_at BEFORE UPDATE ON grn FOR EACH ROW EXECUTE FUNCTION update_grn_updated_at();
CREATE TRIGGER update_grn_items_updated_at BEFORE UPDATE ON grn_items FOR EACH ROW EXECUTE FUNCTION update_grn_updated_at();
CREATE TRIGGER hris_logbook_item_score_refresh AFTER INSERT OR DELETE OR UPDATE ON hris_logbook_entry_items FOR EACH ROW EXECUTE FUNCTION trg_update_hris_logbook_score();
CREATE TRIGGER trg_notify_interview_changes AFTER INSERT OR DELETE OR UPDATE ON interviews FOR EACH ROW EXECUTE FUNCTION fn_notify_interview_changes();
CREATE TRIGGER job_openings_updated_at BEFORE UPDATE ON job_openings FOR EACH ROW EXECUTE FUNCTION update_job_openings_updated_at();
CREATE TRIGGER leave_balances_updated_at BEFORE UPDATE ON leave_balances FOR EACH ROW EXECUTE FUNCTION update_hris_updated_at();
CREATE TRIGGER leaves_calculate_total_days BEFORE INSERT OR UPDATE ON leaves FOR EACH ROW EXECUTE FUNCTION calculate_leave_days();
CREATE TRIGGER leaves_updated_at BEFORE UPDATE ON leaves FOR EACH ROW EXECUTE FUNCTION update_hris_updated_at();
CREATE TRIGGER trg_notify_leave_changes AFTER INSERT OR DELETE OR UPDATE ON leaves FOR EACH ROW EXECUTE FUNCTION fn_notify_leave_changes();
CREATE TRIGGER offboarding_complete_update_employee AFTER UPDATE ON offboarding_checklists FOR EACH ROW WHEN (new.status = 'completed'::offboarding_status AND old.status <> 'completed'::offboarding_status) EXECUTE FUNCTION update_employee_offboarding_status();
CREATE TRIGGER trg_notify_offboarding_changes AFTER INSERT OR DELETE OR UPDATE ON offboarding_checklists FOR EACH ROW EXECUTE FUNCTION fn_notify_offboarding_changes();
CREATE TRIGGER trg_notify_onboarding_changes AFTER DELETE OR UPDATE ON onboarding_checklists FOR EACH ROW EXECUTE FUNCTION fn_notify_onboarding_changes();
CREATE TRIGGER update_pos_customers_updated_at BEFORE UPDATE ON pos_customers FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER pos_order_shift_totals_trigger AFTER UPDATE ON pos_orders FOR EACH ROW WHEN (old.status IS DISTINCT FROM new.status OR old.payment_status IS DISTINCT FROM new.payment_status) EXECUTE FUNCTION pos_update_shift_totals();
CREATE TRIGGER update_pos_products_updated_at BEFORE UPDATE ON pos_products FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_pos_tables_updated_at BEFORE UPDATE ON pos_tables FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_products_updated_at BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_po_updated_at BEFORE UPDATE ON purchase_orders FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_purchase_requests_updated_at BEFORE UPDATE ON purchase_requests FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_generate_return_number BEFORE INSERT ON purchase_returns FOR EACH ROW WHEN (new.return_number IS NULL) EXECUTE FUNCTION generate_return_number();
CREATE TRIGGER trg_generate_vendor_credit_number BEFORE INSERT ON vendor_credits FOR EACH ROW WHEN ((new.credit_number IS NULL) OR (new.credit_number = ''::character varying)) EXECUTE FUNCTION generate_vendor_credit_number();
CREATE TRIGGER trg_process_return_approval AFTER UPDATE ON purchase_returns FOR EACH ROW EXECUTE FUNCTION process_return_approval();
CREATE TRIGGER update_raw_materials_updated_at BEFORE UPDATE ON raw_materials FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER staff_updated_at BEFORE UPDATE ON staff FOR EACH ROW EXECUTE FUNCTION update_staff_updated_at();
CREATE TRIGGER update_supplier_price_lists_updated_at BEFORE UPDATE ON supplier_price_lists FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_suppliers_updated_at BEFORE UPDATE ON suppliers FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_units_updated_at BEFORE UPDATE ON units FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_vendor_documents_intake_number BEFORE INSERT ON vendor_documents FOR EACH ROW EXECUTE FUNCTION set_vendor_document_intake_number();
CREATE TRIGGER trg_vendor_documents_updated_at BEFORE UPDATE ON vendor_documents FOR EACH ROW EXECUTE FUNCTION set_vendor_documents_updated_at();
CREATE TRIGGER trg_sync_purchase_order_payment_term AFTER INSERT OR DELETE OR UPDATE ON vendor_payments FOR EACH ROW EXECUTE FUNCTION sync_purchase_order_payment_term();
