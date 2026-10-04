-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — foreign keys
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:30:14.238Z
-- =============================================================================

ALTER TABLE ONLY "iam"."menus"
    ADD CONSTRAINT "menus_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY "iam"."menus"
    ADD CONSTRAINT "menus_deleted_by_fkey" FOREIGN KEY (deleted_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY "iam"."menus"
    ADD CONSTRAINT "menus_parent_id_fkey" FOREIGN KEY (parent_id) REFERENCES iam.menus(id) ON DELETE CASCADE;
ALTER TABLE ONLY "iam"."menus"
    ADD CONSTRAINT "menus_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY "iam"."role_menu_permissions"
    ADD CONSTRAINT "role_menu_permissions_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY "iam"."role_menu_permissions"
    ADD CONSTRAINT "role_menu_permissions_menu_id_fkey" FOREIGN KEY (menu_id) REFERENCES iam.menus(id) ON DELETE CASCADE;
ALTER TABLE ONLY "iam"."role_menu_permissions"
    ADD CONSTRAINT "role_menu_permissions_role_id_fkey" FOREIGN KEY (role_id) REFERENCES iam.roles(id) ON DELETE CASCADE;
ALTER TABLE ONLY "iam"."role_menu_permissions"
    ADD CONSTRAINT "role_menu_permissions_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY "iam"."user_roles"
    ADD CONSTRAINT "user_roles_assigned_by_fkey" FOREIGN KEY (assigned_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY "iam"."user_roles"
    ADD CONSTRAINT "user_roles_role_id_fkey" FOREIGN KEY (role_id) REFERENCES iam.roles(id) ON DELETE CASCADE;
ALTER TABLE ONLY "iam"."user_roles"
    ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE ONLY "configuration"."admin_user_audit_logs"
    ADD CONSTRAINT "admin_user_audit_logs_actor_id_fkey" FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY "configuration"."admin_user_audit_logs"
    ADD CONSTRAINT "admin_user_audit_logs_target_user_id_fkey" FOREIGN KEY (target_user_id) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE ONLY "public"."ai_assistant_messages"
    ADD CONSTRAINT "ai_assistant_messages_session_id_fkey" FOREIGN KEY (session_id) REFERENCES ai_assistant_sessions(id) ON DELETE CASCADE;
ALTER TABLE ONLY "public"."ai_assistant_sessions"
    ADD CONSTRAINT "ai_assistant_sessions_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY "hris"."attendance"
    ADD CONSTRAINT "attendance_employee_id_fkey" FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE;
ALTER TABLE ONLY "hris"."attendance"
    ADD CONSTRAINT "attendance_validated_by_fkey" FOREIGN KEY (validated_by) REFERENCES employees(id);
ALTER TABLE ONLY "performance"."behavioral_assessments"
    ADD CONSTRAINT "behavioral_assessments_assessed_by_fkey" FOREIGN KEY (assessed_by) REFERENCES employees(id) ON DELETE SET NULL;
ALTER TABLE ONLY "performance"."behavioral_assessments"
    ADD CONSTRAINT "behavioral_assessments_employee_id_fkey" FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE;
ALTER TABLE ONLY "performance"."behavioral_assessments"
    ADD CONSTRAINT "behavioral_assessments_review_id_fkey" FOREIGN KEY (review_id) REFERENCES performance_reviews(id) ON DELETE CASCADE;
ALTER TABLE ONLY "performance"."behavioral_review_items"
    ADD CONSTRAINT "behavioral_review_items_employee_id_fkey" FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE;
ALTER TABLE ONLY "performance"."behavioral_review_items"
    ADD CONSTRAINT "behavioral_review_items_review_id_fkey" FOREIGN KEY (review_id) REFERENCES performance_reviews(id) ON DELETE CASCADE;
ALTER TABLE ONLY "performance"."behavioral_review_items"
    ADD CONSTRAINT "behavioral_review_items_template_behavioral_id_fkey" FOREIGN KEY (template_behavioral_id) REFERENCES kpi_template_behavioral(id) ON DELETE SET NULL;
ALTER TABLE ONLY "manufacturing"."bom_items"
    ADD CONSTRAINT "bom_items_product_id_fkey" FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE;
ALTER TABLE ONLY "manufacturing"."bom_items"
    ADD CONSTRAINT "bom_items_raw_material_id_fkey" FOREIGN KEY (raw_material_id) REFERENCES raw_materials(id);
ALTER TABLE ONLY "manufacturing"."bom_items"
    ADD CONSTRAINT "bom_items_satuan_id_fkey" FOREIGN KEY (satuan_id) REFERENCES units(id);
ALTER TABLE ONLY "recruitment"."candidates"
    ADD CONSTRAINT "candidates_brand_id_fkey" FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE SET NULL;
ALTER TABLE ONLY "recruitment"."candidates"
    ADD CONSTRAINT "candidates_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY "recruitment"."candidates"
    ADD CONSTRAINT "candidates_job_opening_id_fkey" FOREIGN KEY (job_opening_id) REFERENCES job_openings(id) ON DELETE SET NULL;
ALTER TABLE ONLY "recruitment"."candidates"
    ADD CONSTRAINT "candidates_position_id_fkey" FOREIGN KEY (position_id) REFERENCES positions(id) ON DELETE SET NULL;
ALTER TABLE ONLY "recruitment"."candidates"
    ADD CONSTRAINT "candidates_promoted_to_employee_id_fkey" FOREIGN KEY (promoted_to_employee_id) REFERENCES employees(id) ON DELETE SET NULL;
ALTER TABLE ONLY "purchasing"."cogs_additional_costs"
    ADD CONSTRAINT "cogs_additional_costs_created_by_fkey" FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE ONLY "purchasing"."cogs_additional_costs"
    ADD CONSTRAINT "cogs_additional_costs_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE ONLY "crm"."crm_collectible_avatars"
    ADD CONSTRAINT "crm_collectible_avatars_required_tier_id_fkey" FOREIGN KEY (required_tier_id) REFERENCES crm_membership_tiers(id) ON DELETE SET NULL;
ALTER TABLE ONLY "crm"."crm_external_events"
    ADD CONSTRAINT "crm_external_events_customer_id_fkey" FOREIGN KEY (customer_id) REFERENCES pos_customers(id) ON DELETE SET NULL;
ALTER TABLE ONLY "crm"."crm_external_events"
    ADD CONSTRAINT "crm_external_events_member_id_fkey" FOREIGN KEY (member_id) REFERENCES crm_member_profiles(id) ON DELETE SET NULL;
ALTER TABLE ONLY "crm"."crm_external_events"
    ADD CONSTRAINT "crm_external_events_partner_id_fkey" FOREIGN KEY (partner_id) REFERENCES crm_integration_partners(id) ON DELETE RESTRICT;
ALTER TABLE ONLY "crm"."crm_external_events"
    ADD CONSTRAINT "crm_external_events_xp_ledger_id_fkey" FOREIGN KEY (xp_ledger_id) REFERENCES crm_xp_ledger(id) ON DELETE SET NULL;
ALTER TABLE ONLY "crm"."crm_external_events"
    ADD CONSTRAINT "crm_external_events_xp_rule_id_fkey" FOREIGN KEY (xp_rule_id) REFERENCES crm_xp_rules(id) ON DELETE SET NULL;
ALTER TABLE ONLY "crm"."crm_member_avatar_inventory"
    ADD CONSTRAINT "crm_member_avatar_inventory_avatar_id_fkey" FOREIGN KEY (avatar_id) REFERENCES crm_collectible_avatars(id) ON DELETE CASCADE;
ALTER TABLE ONLY "crm"."crm_member_avatar_inventory"
    ADD CONSTRAINT "crm_member_avatar_inventory_member_id_fkey" FOREIGN KEY (member_id) REFERENCES crm_member_profiles(id) ON DELETE CASCADE;
ALTER TABLE ONLY "crm"."crm_member_avatar_inventory"
    ADD CONSTRAINT "crm_member_avatar_inventory_redemption_id_fkey" FOREIGN KEY (redemption_id) REFERENCES crm_redemptions(id) ON DELETE SET NULL;
ALTER TABLE ONLY "crm"."crm_member_profiles"
    ADD CONSTRAINT "crm_member_profiles_active_avatar_id_fkey" FOREIGN KEY (active_avatar_id) REFERENCES crm_collectible_avatars(id) ON DELETE SET NULL;
ALTER TABLE ONLY "crm"."crm_member_profiles"
    ADD CONSTRAINT "crm_member_profiles_customer_id_fkey" FOREIGN KEY (customer_id) REFERENCES pos_customers(id) ON DELETE CASCADE;
ALTER TABLE ONLY "crm"."crm_member_profiles"
    ADD CONSTRAINT "crm_member_profiles_tier_id_fkey" FOREIGN KEY (tier_id) REFERENCES crm_membership_tiers(id) ON DELETE RESTRICT;
ALTER TABLE ONLY "crm"."crm_redemptions"
    ADD CONSTRAINT "crm_redemptions_customer_id_fkey" FOREIGN KEY (customer_id) REFERENCES pos_customers(id) ON DELETE SET NULL;
ALTER TABLE ONLY "crm"."crm_redemptions"
    ADD CONSTRAINT "crm_redemptions_member_id_fkey" FOREIGN KEY (member_id) REFERENCES crm_member_profiles(id) ON DELETE CASCADE;
ALTER TABLE ONLY "crm"."crm_redemptions"
    ADD CONSTRAINT "crm_redemptions_reward_id_fkey" FOREIGN KEY (reward_id) REFERENCES crm_rewards(id) ON DELETE RESTRICT;
ALTER TABLE ONLY "crm"."crm_redemptions"
    ADD CONSTRAINT "crm_redemptions_xp_ledger_id_fkey" FOREIGN KEY (xp_ledger_id) REFERENCES crm_xp_ledger(id) ON DELETE SET NULL;
ALTER TABLE ONLY "crm"."crm_rewards"
    ADD CONSTRAINT "crm_rewards_linked_avatar_id_fkey" FOREIGN KEY (linked_avatar_id) REFERENCES crm_collectible_avatars(id) ON DELETE SET NULL;
ALTER TABLE ONLY "crm"."crm_rewards"
    ADD CONSTRAINT "crm_rewards_required_tier_id_fkey" FOREIGN KEY (required_tier_id) REFERENCES crm_membership_tiers(id) ON DELETE SET NULL;
ALTER TABLE ONLY "crm"."crm_xp_ledger"
    ADD CONSTRAINT "crm_xp_ledger_customer_id_fkey" FOREIGN KEY (customer_id) REFERENCES pos_customers(id) ON DELETE SET NULL;
ALTER TABLE ONLY "crm"."crm_xp_ledger"
    ADD CONSTRAINT "crm_xp_ledger_member_id_fkey" FOREIGN KEY (member_id) REFERENCES crm_member_profiles(id) ON DELETE CASCADE;
ALTER TABLE ONLY "crm"."crm_xp_ledger"
    ADD CONSTRAINT "crm_xp_ledger_rule_id_fkey" FOREIGN KEY (rule_id) REFERENCES crm_xp_rules(id) ON DELETE SET NULL;
ALTER TABLE ONLY "purchasing"."deliveries"
    ADD CONSTRAINT "deliveries_created_by_fkey" FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE ONLY "purchasing"."deliveries"
    ADD CONSTRAINT "deliveries_purchase_order_id_fkey" FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id) ON DELETE CASCADE;
ALTER TABLE ONLY "purchasing"."deliveries"
    ADD CONSTRAINT "deliveries_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE ONLY "hris"."departments"
    ADD CONSTRAINT "departments_brand_id_fkey" FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE CASCADE;
ALTER TABLE ONLY "hris"."departments"
    ADD CONSTRAINT "departments_parent_department_id_fkey" FOREIGN KEY (parent_department_id) REFERENCES departments(id) ON DELETE SET NULL;
ALTER TABLE ONLY "hris"."development_plans"
    ADD CONSTRAINT "development_plans_employee_id_fkey" FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE;
ALTER TABLE ONLY "hris"."development_plans"
    ADD CONSTRAINT "development_plans_review_id_fkey" FOREIGN KEY (review_id) REFERENCES performance_reviews(id) ON DELETE CASCADE;
ALTER TABLE ONLY "hris"."employee_benefits"
    ADD CONSTRAINT "employee_benefits_benefit_id_fkey" FOREIGN KEY (benefit_id) REFERENCES benefits(id) ON DELETE CASCADE;
ALTER TABLE ONLY "hris"."employee_benefits"
    ADD CONSTRAINT "employee_benefits_employee_id_fkey" FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE;
ALTER TABLE ONLY "hris"."employee_documents"
    ADD CONSTRAINT "employee_documents_employee_id_fkey" FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE;
ALTER TABLE ONLY "hris"."employee_documents"
    ADD CONSTRAINT "employee_documents_uploaded_by_fkey" FOREIGN KEY (uploaded_by) REFERENCES employees(id);
ALTER TABLE ONLY "hris"."employee_documents"
    ADD CONSTRAINT "employee_documents_verified_by_fkey" FOREIGN KEY (verified_by) REFERENCES employees(id);
ALTER TABLE ONLY "hris"."employee_kpis"
    ADD CONSTRAINT "employee_kpis_employee_id_fkey" FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE;
ALTER TABLE ONLY "hris"."employee_kpis"
    ADD CONSTRAINT "employee_kpis_review_id_fkey" FOREIGN KEY (review_id) REFERENCES performance_reviews(id) ON DELETE CASCADE;
ALTER TABLE ONLY "hris"."employee_kpis"
    ADD CONSTRAINT "employee_kpis_reviewed_by_fkey" FOREIGN KEY (reviewed_by) REFERENCES employees(id) ON DELETE SET NULL;
ALTER TABLE ONLY "hris"."employee_kpis"
    ADD CONSTRAINT "employee_kpis_template_item_id_fkey" FOREIGN KEY (template_item_id) REFERENCES kpi_template_items(id) ON DELETE SET NULL;
ALTER TABLE ONLY "hris"."employee_salary"
    ADD CONSTRAINT "employee_salary_employee_id_fkey" FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE;
ALTER TABLE ONLY "hris"."employee_schedules"
    ADD CONSTRAINT "employee_schedules_employee_id_fkey" FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE;
ALTER TABLE ONLY "hris"."employees"
    ADD CONSTRAINT "employees_department_id_fkey" FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL;
ALTER TABLE ONLY "hris"."employees"
    ADD CONSTRAINT "employees_job_title_id_fkey" FOREIGN KEY (job_title_id) REFERENCES positions(id) ON DELETE SET NULL;
ALTER TABLE ONLY "hris"."employees"
    ADD CONSTRAINT "employees_old_staff_id_fkey" FOREIGN KEY (old_staff_id) REFERENCES staff(id) ON DELETE SET NULL;
ALTER TABLE ONLY "hris"."employees"
    ADD CONSTRAINT "employees_reporting_to_fkey" FOREIGN KEY (reporting_to) REFERENCES employees(id) ON DELETE SET NULL;
ALTER TABLE ONLY "hris"."employees"
    ADD CONSTRAINT "employees_section_id_fkey" FOREIGN KEY (section_id) REFERENCES sections(id) ON DELETE SET NULL;
ALTER TABLE ONLY "hris"."employees"
    ADD CONSTRAINT "employees_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY "hris"."employment_history"
    ADD CONSTRAINT "employment_history_employee_id_fkey" FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE;
ALTER TABLE ONLY "hris"."employment_history"
    ADD CONSTRAINT "employment_history_new_department_id_fkey" FOREIGN KEY (new_department_id) REFERENCES departments(id);
ALTER TABLE ONLY "hris"."employment_history"
    ADD CONSTRAINT "employment_history_new_job_title_id_fkey" FOREIGN KEY (new_job_title_id) REFERENCES positions(id);
ALTER TABLE ONLY "hris"."employment_history"
    ADD CONSTRAINT "employment_history_new_section_id_fkey" FOREIGN KEY (new_section_id) REFERENCES sections(id);
ALTER TABLE ONLY "hris"."employment_history"
    ADD CONSTRAINT "employment_history_prev_department_id_fkey" FOREIGN KEY (prev_department_id) REFERENCES departments(id);
ALTER TABLE ONLY "hris"."employment_history"
    ADD CONSTRAINT "employment_history_prev_job_title_id_fkey" FOREIGN KEY (prev_job_title_id) REFERENCES positions(id);
ALTER TABLE ONLY "hris"."employment_history"
    ADD CONSTRAINT "employment_history_prev_section_id_fkey" FOREIGN KEY (prev_section_id) REFERENCES sections(id);
ALTER TABLE ONLY "hris"."employment_history"
    ADD CONSTRAINT "employment_history_recorded_by_fkey" FOREIGN KEY (recorded_by) REFERENCES employees(id);
ALTER TABLE ONLY "performance"."feedback_assignments"
    ADD CONSTRAINT "feedback_assignments_approved_by_fkey" FOREIGN KEY (approved_by) REFERENCES employees(id);
ALTER TABLE ONLY "performance"."feedback_assignments"
    ADD CONSTRAINT "feedback_assignments_cycle_id_fkey" FOREIGN KEY (cycle_id) REFERENCES feedback_cycles(id) ON DELETE CASCADE;
ALTER TABLE ONLY "performance"."feedback_assignments"
    ADD CONSTRAINT "feedback_assignments_employee_id_fkey" FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE;
ALTER TABLE ONLY "performance"."feedback_assignments"
    ADD CONSTRAINT "feedback_assignments_reviewer_id_fkey" FOREIGN KEY (reviewer_id) REFERENCES employees(id) ON DELETE SET NULL;
ALTER TABLE ONLY "performance"."feedback_criteria"
    ADD CONSTRAINT "feedback_criteria_category_id_fkey" FOREIGN KEY (category_id) REFERENCES feedback_categories(id) ON DELETE CASCADE;
ALTER TABLE ONLY "performance"."feedback_cycles"
    ADD CONSTRAINT "feedback_cycles_created_by_fkey" FOREIGN KEY (created_by) REFERENCES employees(id);
ALTER TABLE ONLY "performance"."feedback_responses"
    ADD CONSTRAINT "feedback_responses_assignment_id_fkey" FOREIGN KEY (assignment_id) REFERENCES feedback_assignments(id) ON DELETE CASCADE;
ALTER TABLE ONLY "performance"."feedback_responses"
    ADD CONSTRAINT "feedback_responses_criteria_id_fkey" FOREIGN KEY (criteria_id) REFERENCES feedback_criteria(id) ON DELETE RESTRICT;
ALTER TABLE ONLY "performance"."feedback_summaries"
    ADD CONSTRAINT "feedback_summaries_cycle_id_fkey" FOREIGN KEY (cycle_id) REFERENCES feedback_cycles(id) ON DELETE CASCADE;
ALTER TABLE ONLY "performance"."feedback_summaries"
    ADD CONSTRAINT "feedback_summaries_employee_id_fkey" FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE;
ALTER TABLE ONLY "performance"."feedback_summaries"
    ADD CONSTRAINT "feedback_summaries_locked_by_fkey" FOREIGN KEY (locked_by) REFERENCES employees(id);
ALTER TABLE ONLY "performance"."feedback_summaries"
    ADD CONSTRAINT "feedback_summaries_reviewed_by_fkey" FOREIGN KEY (reviewed_by) REFERENCES employees(id);
ALTER TABLE ONLY "inventory"."finished_goods_inventory"
    ADD CONSTRAINT "finished_goods_inventory_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id);
ALTER TABLE ONLY "inventory"."finished_goods_inventory"
    ADD CONSTRAINT "finished_goods_inventory_product_id_fkey" FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT;
ALTER TABLE ONLY "inventory"."finished_goods_inventory"
    ADD CONSTRAINT "finished_goods_inventory_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES auth.users(id);
ALTER TABLE ONLY "purchasing"."grn"
    ADD CONSTRAINT "grn_created_by_fkey" FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE ONLY "purchasing"."grn"
    ADD CONSTRAINT "grn_delivery_id_fkey" FOREIGN KEY (delivery_id) REFERENCES deliveries(id) ON DELETE SET NULL;
ALTER TABLE ONLY "purchasing"."grn"
    ADD CONSTRAINT "grn_penerima_id_fkey" FOREIGN KEY (penerima_id) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE ONLY "purchasing"."grn"
    ADD CONSTRAINT "grn_purchase_order_id_fkey" FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id) ON DELETE RESTRICT;
ALTER TABLE ONLY "purchasing"."grn"
    ADD CONSTRAINT "grn_supplier_id_fkey" FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE RESTRICT;
ALTER TABLE ONLY "purchasing"."grn"
    ADD CONSTRAINT "grn_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE ONLY "purchasing"."grn_items"
    ADD CONSTRAINT "grn_items_delivery_id_fkey" FOREIGN KEY (delivery_id) REFERENCES deliveries(id) ON DELETE SET NULL;
ALTER TABLE ONLY "purchasing"."grn_items"
    ADD CONSTRAINT "grn_items_grn_id_fkey" FOREIGN KEY (grn_id) REFERENCES grn(id) ON DELETE CASCADE;
ALTER TABLE ONLY "purchasing"."grn_items"
    ADD CONSTRAINT "grn_items_purchase_order_item_id_fkey" FOREIGN KEY (purchase_order_item_id) REFERENCES purchase_order_items(id) ON DELETE SET NULL;
ALTER TABLE ONLY "purchasing"."grn_items"
    ADD CONSTRAINT "grn_items_raw_material_id_fkey" FOREIGN KEY (raw_material_id) REFERENCES raw_materials(id) ON DELETE RESTRICT;
ALTER TABLE ONLY "purchasing"."grn_items"
    ADD CONSTRAINT "grn_items_satuan_id_fkey" FOREIGN KEY (satuan_id) REFERENCES units(id) ON DELETE SET NULL;
ALTER TABLE ONLY "hris"."hris_logbook_entries"
    ADD CONSTRAINT "hris_logbook_entries_department_id_fkey" FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE;
ALTER TABLE ONLY "hris"."hris_logbook_entries"
    ADD CONSTRAINT "hris_logbook_entries_reviewed_by_fkey" FOREIGN KEY (reviewed_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY "hris"."hris_logbook_entries"
    ADD CONSTRAINT "hris_logbook_entries_submitted_by_fkey" FOREIGN KEY (submitted_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY "hris"."hris_logbook_entries"
    ADD CONSTRAINT "hris_logbook_entries_template_id_fkey" FOREIGN KEY (template_id) REFERENCES hris_logbook_templates(id) ON DELETE SET NULL;
ALTER TABLE ONLY "hris"."hris_logbook_entry_items"
    ADD CONSTRAINT "hris_logbook_entry_items_checked_by_fkey" FOREIGN KEY (checked_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY "hris"."hris_logbook_entry_items"
    ADD CONSTRAINT "hris_logbook_entry_items_entry_id_fkey" FOREIGN KEY (entry_id) REFERENCES hris_logbook_entries(id) ON DELETE CASCADE;
ALTER TABLE ONLY "hris"."hris_logbook_entry_items"
    ADD CONSTRAINT "hris_logbook_entry_items_template_item_id_fkey" FOREIGN KEY (template_item_id) REFERENCES hris_logbook_template_items(id) ON DELETE SET NULL;
ALTER TABLE ONLY "hris"."hris_logbook_template_items"
    ADD CONSTRAINT "hris_logbook_template_items_template_id_fkey" FOREIGN KEY (template_id) REFERENCES hris_logbook_templates(id) ON DELETE CASCADE;
ALTER TABLE ONLY "hris"."hris_logbook_templates"
    ADD CONSTRAINT "hris_logbook_templates_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY "hris"."hris_logbook_templates"
    ADD CONSTRAINT "hris_logbook_templates_department_id_fkey" FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE;
ALTER TABLE ONLY "recruitment"."interviews"
    ADD CONSTRAINT "interviews_candidate_id_fkey" FOREIGN KEY (candidate_id) REFERENCES candidates(id) ON DELETE CASCADE;
ALTER TABLE ONLY "recruitment"."interviews"
    ADD CONSTRAINT "interviews_interviewer_id_fkey" FOREIGN KEY (interviewer_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY "inventory"."inventory"
    ADD CONSTRAINT "inventory_raw_material_id_fkey" FOREIGN KEY (raw_material_id) REFERENCES raw_materials(id) ON DELETE CASCADE;
ALTER TABLE ONLY "inventory"."inventory_movements"
    ADD CONSTRAINT "inventory_movements_inventory_id_fkey" FOREIGN KEY (inventory_id) REFERENCES inventory(id) ON DELETE RESTRICT;
ALTER TABLE ONLY "inventory"."inventory_movements"
    ADD CONSTRAINT "inventory_movements_raw_material_id_fkey" FOREIGN KEY (raw_material_id) REFERENCES raw_materials(id) ON DELETE RESTRICT;
ALTER TABLE ONLY "inventory"."inventory_movements"
    ADD CONSTRAINT "inventory_movements_return_id_fkey" FOREIGN KEY (return_id) REFERENCES purchase_returns(id) ON DELETE SET NULL;
ALTER TABLE ONLY "recruitment"."job_openings"
    ADD CONSTRAINT "job_openings_brand_id_fkey" FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE SET NULL;
ALTER TABLE ONLY "recruitment"."job_openings"
    ADD CONSTRAINT "job_openings_department_id_fkey" FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL;
ALTER TABLE ONLY "recruitment"."job_openings"
    ADD CONSTRAINT "job_openings_position_id_fkey" FOREIGN KEY (position_id) REFERENCES positions(id) ON DELETE SET NULL;
ALTER TABLE ONLY "performance"."kpi_template_behavioral"
    ADD CONSTRAINT "kpi_template_behavioral_template_id_fkey" FOREIGN KEY (template_id) REFERENCES kpi_templates(id) ON DELETE CASCADE;
ALTER TABLE ONLY "performance"."kpi_template_items"
    ADD CONSTRAINT "kpi_template_items_template_id_fkey" FOREIGN KEY (template_id) REFERENCES kpi_templates(id) ON DELETE CASCADE;
ALTER TABLE ONLY "performance"."kpi_templates"
    ADD CONSTRAINT "kpi_templates_approved_by_fkey" FOREIGN KEY (approved_by) REFERENCES employees(id) ON DELETE SET NULL;
ALTER TABLE ONLY "performance"."kpi_templates"
    ADD CONSTRAINT "kpi_templates_created_by_fkey" FOREIGN KEY (created_by) REFERENCES employees(id) ON DELETE SET NULL;
ALTER TABLE ONLY "performance"."kpi_templates"
    ADD CONSTRAINT "kpi_templates_department_id_fkey" FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL;
ALTER TABLE ONLY "performance"."kpi_templates"
    ADD CONSTRAINT "kpi_templates_position_id_fkey" FOREIGN KEY (position_id) REFERENCES positions(id) ON DELETE SET NULL;
ALTER TABLE ONLY "hris"."leave_balances"
    ADD CONSTRAINT "leave_balances_employee_id_fkey" FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE;
ALTER TABLE ONLY "hris"."leaves"
    ADD CONSTRAINT "leaves_approved_by_fkey" FOREIGN KEY (approved_by) REFERENCES employees(id);
ALTER TABLE ONLY "hris"."leaves"
    ADD CONSTRAINT "leaves_employee_id_fkey" FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE;
ALTER TABLE ONLY "hris"."loans"
    ADD CONSTRAINT "loans_approved_by_fkey" FOREIGN KEY (approved_by) REFERENCES employees(id);
ALTER TABLE ONLY "hris"."loans"
    ADD CONSTRAINT "loans_employee_id_fkey" FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE;
ALTER TABLE ONLY "hris"."loans"
    ADD CONSTRAINT "loans_rejected_by_fkey" FOREIGN KEY (rejected_by) REFERENCES employees(id);
ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE ONLY "public"."notifications_log"
    ADD CONSTRAINT "notifications_log_candidate_id_fkey" FOREIGN KEY (candidate_id) REFERENCES candidates(id) ON DELETE SET NULL;
ALTER TABLE ONLY "hris"."offboarding_checklists"
    ADD CONSTRAINT "offboarding_checklists_completed_by_fkey" FOREIGN KEY (completed_by) REFERENCES employees(id);
ALTER TABLE ONLY "hris"."offboarding_checklists"
    ADD CONSTRAINT "offboarding_checklists_employee_id_fkey" FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE;
ALTER TABLE ONLY "hris"."offboarding_checklists"
    ADD CONSTRAINT "offboarding_checklists_exit_interview_conducted_by_fkey" FOREIGN KEY (exit_interview_conducted_by) REFERENCES employees(id);
ALTER TABLE ONLY "hris"."onboarding_checklists"
    ADD CONSTRAINT "onboarding_checklists_assigned_to_fkey" FOREIGN KEY (assigned_to) REFERENCES employees(id);
ALTER TABLE ONLY "hris"."onboarding_checklists"
    ADD CONSTRAINT "onboarding_checklists_completed_by_fkey" FOREIGN KEY (completed_by) REFERENCES employees(id);
ALTER TABLE ONLY "hris"."onboarding_checklists"
    ADD CONSTRAINT "onboarding_checklists_employee_id_fkey" FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE;
ALTER TABLE ONLY "hris"."payroll_details"
    ADD CONSTRAINT "payroll_details_employee_id_fkey" FOREIGN KEY (employee_id) REFERENCES employees(id);
ALTER TABLE ONLY "hris"."payroll_details"
    ADD CONSTRAINT "payroll_details_payroll_run_id_fkey" FOREIGN KEY (payroll_run_id) REFERENCES payroll_runs(id) ON DELETE CASCADE;
ALTER TABLE ONLY "hris"."payroll_runs"
    ADD CONSTRAINT "payroll_runs_approved_by_fkey" FOREIGN KEY (approved_by) REFERENCES employees(id);
ALTER TABLE ONLY "hris"."payroll_runs"
    ADD CONSTRAINT "payroll_runs_processed_by_fkey" FOREIGN KEY (processed_by) REFERENCES employees(id);
ALTER TABLE ONLY "performance"."performance_reviews"
    ADD CONSTRAINT "performance_reviews_employee_department_id_fkey" FOREIGN KEY (employee_department_id) REFERENCES departments(id) ON DELETE SET NULL;
ALTER TABLE ONLY "performance"."performance_reviews"
    ADD CONSTRAINT "performance_reviews_employee_id_fkey" FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE;
ALTER TABLE ONLY "performance"."performance_reviews"
    ADD CONSTRAINT "performance_reviews_employee_position_id_fkey" FOREIGN KEY (employee_position_id) REFERENCES positions(id) ON DELETE SET NULL;
ALTER TABLE ONLY "performance"."performance_reviews"
    ADD CONSTRAINT "performance_reviews_kpi_template_id_fkey" FOREIGN KEY (kpi_template_id) REFERENCES kpi_templates(id) ON DELETE SET NULL;
ALTER TABLE ONLY "performance"."performance_reviews"
    ADD CONSTRAINT "performance_reviews_manager_id_fkey" FOREIGN KEY (manager_id) REFERENCES employees(id) ON DELETE SET NULL;
ALTER TABLE ONLY "performance"."performance_reviews"
    ADD CONSTRAINT "performance_reviews_reviewer_id_fkey" FOREIGN KEY (reviewer_id) REFERENCES employees(id) ON DELETE SET NULL;
ALTER TABLE ONLY "pos"."pos_categories"
    ADD CONSTRAINT "pos_categories_parent_id_fkey" FOREIGN KEY (parent_id) REFERENCES pos_categories(id);
ALTER TABLE ONLY "pos"."pos_customer_vouchers"
    ADD CONSTRAINT "pos_customer_vouchers_customer_id_fkey" FOREIGN KEY (customer_id) REFERENCES pos_customers(id);
ALTER TABLE ONLY "pos"."pos_customer_vouchers"
    ADD CONSTRAINT "pos_customer_vouchers_order_id_fkey" FOREIGN KEY (order_id) REFERENCES pos_orders(id);
ALTER TABLE ONLY "pos"."pos_customer_vouchers"
    ADD CONSTRAINT "pos_customer_vouchers_voucher_id_fkey" FOREIGN KEY (voucher_id) REFERENCES pos_vouchers(id);
ALTER TABLE ONLY "pos"."pos_inventory_settings"
    ADD CONSTRAINT "pos_inventory_settings_product_id_fkey" FOREIGN KEY (product_id) REFERENCES pos_products(id) ON DELETE CASCADE;
ALTER TABLE ONLY "pos"."pos_kds_orders"
    ADD CONSTRAINT "pos_kds_orders_item_id_fkey" FOREIGN KEY (item_id) REFERENCES pos_order_items(id) ON DELETE CASCADE;
ALTER TABLE ONLY "pos"."pos_kds_orders"
    ADD CONSTRAINT "pos_kds_orders_order_id_fkey" FOREIGN KEY (order_id) REFERENCES pos_orders(id) ON DELETE CASCADE;
ALTER TABLE ONLY "pos"."pos_kds_orders"
    ADD CONSTRAINT "pos_kds_orders_station_id_fkey" FOREIGN KEY (station_id) REFERENCES pos_kds_stations(id);
ALTER TABLE ONLY "pos"."pos_modifiers"
    ADD CONSTRAINT "pos_modifiers_group_id_fkey" FOREIGN KEY (group_id) REFERENCES pos_modifier_groups(id) ON DELETE CASCADE;
ALTER TABLE ONLY "pos"."pos_order_items"
    ADD CONSTRAINT "pos_order_items_order_id_fkey" FOREIGN KEY (order_id) REFERENCES pos_orders(id) ON DELETE CASCADE;
ALTER TABLE ONLY "pos"."pos_order_items"
    ADD CONSTRAINT "pos_order_items_product_id_fkey" FOREIGN KEY (product_id) REFERENCES pos_products(id);
ALTER TABLE ONLY "pos"."pos_order_split_items"
    ADD CONSTRAINT "pos_order_split_items_order_item_id_fkey" FOREIGN KEY (order_item_id) REFERENCES pos_order_items(id) ON DELETE CASCADE;
ALTER TABLE ONLY "pos"."pos_order_split_items"
    ADD CONSTRAINT "pos_order_split_items_split_id_fkey" FOREIGN KEY (split_id) REFERENCES pos_order_splits(id) ON DELETE CASCADE;
ALTER TABLE ONLY "pos"."pos_order_splits"
    ADD CONSTRAINT "pos_order_splits_customer_id_fkey" FOREIGN KEY (customer_id) REFERENCES pos_customers(id);
ALTER TABLE ONLY "pos"."pos_order_splits"
    ADD CONSTRAINT "pos_order_splits_order_id_fkey" FOREIGN KEY (order_id) REFERENCES pos_orders(id) ON DELETE CASCADE;
ALTER TABLE ONLY "pos"."pos_order_status_history"
    ADD CONSTRAINT "pos_order_status_history_order_id_fkey" FOREIGN KEY (order_id) REFERENCES pos_orders(id) ON DELETE CASCADE;
ALTER TABLE ONLY "pos"."pos_orders"
    ADD CONSTRAINT "pos_orders_customer_id_fkey" FOREIGN KEY (customer_id) REFERENCES pos_customers(id);
ALTER TABLE ONLY "pos"."pos_orders"
    ADD CONSTRAINT "pos_orders_merged_to_order_id_fkey" FOREIGN KEY (merged_to_order_id) REFERENCES pos_orders(id) ON DELETE SET NULL;
ALTER TABLE ONLY "pos"."pos_orders"
    ADD CONSTRAINT "pos_orders_shift_id_fkey" FOREIGN KEY (shift_id) REFERENCES pos_shifts(id) ON DELETE SET NULL;
ALTER TABLE ONLY "pos"."pos_orders"
    ADD CONSTRAINT "pos_orders_voided_by_fkey" FOREIGN KEY (voided_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY "pos"."pos_print_jobs"
    ADD CONSTRAINT "pos_print_jobs_order_id_fkey" FOREIGN KEY (order_id) REFERENCES pos_orders(id) ON DELETE CASCADE;
ALTER TABLE ONLY "pos"."pos_product_modifiers"
    ADD CONSTRAINT "pos_product_modifiers_modifier_group_id_fkey" FOREIGN KEY (modifier_group_id) REFERENCES pos_modifier_groups(id) ON DELETE CASCADE;
ALTER TABLE ONLY "pos"."pos_product_modifiers"
    ADD CONSTRAINT "pos_product_modifiers_product_id_fkey" FOREIGN KEY (product_id) REFERENCES pos_products(id) ON DELETE CASCADE;
ALTER TABLE ONLY "pos"."pos_product_variants"
    ADD CONSTRAINT "pos_product_variants_product_id_fkey" FOREIGN KEY (product_id) REFERENCES pos_products(id) ON DELETE CASCADE;
ALTER TABLE ONLY "pos"."pos_products"
    ADD CONSTRAINT "pos_products_category_id_fkey" FOREIGN KEY (category_id) REFERENCES pos_categories(id);
ALTER TABLE ONLY "pos"."pos_recipes"
    ADD CONSTRAINT "pos_recipes_product_id_fkey" FOREIGN KEY (product_id) REFERENCES pos_products(id) ON DELETE CASCADE;
ALTER TABLE ONLY "pos"."pos_reservations"
    ADD CONSTRAINT "pos_reservations_customer_id_fkey" FOREIGN KEY (customer_id) REFERENCES pos_customers(id);
ALTER TABLE ONLY "pos"."pos_reservations"
    ADD CONSTRAINT "pos_reservations_table_id_fkey" FOREIGN KEY (table_id) REFERENCES pos_tables(id);
ALTER TABLE ONLY "pos"."pos_shift_transactions"
    ADD CONSTRAINT "pos_shift_transactions_order_id_fkey" FOREIGN KEY (order_id) REFERENCES pos_orders(id);
ALTER TABLE ONLY "pos"."pos_shift_transactions"
    ADD CONSTRAINT "pos_shift_transactions_shift_id_fkey" FOREIGN KEY (shift_id) REFERENCES pos_cashier_shifts(id);
ALTER TABLE ONLY "pos"."pos_split_payments"
    ADD CONSTRAINT "pos_split_payments_order_id_fkey" FOREIGN KEY (order_id) REFERENCES pos_orders(id) ON DELETE CASCADE;
ALTER TABLE ONLY "pos"."pos_split_payments"
    ADD CONSTRAINT "pos_split_payments_split_id_fkey" FOREIGN KEY (split_id) REFERENCES pos_order_splits(id) ON DELETE CASCADE;
ALTER TABLE ONLY "pos"."pos_tables"
    ADD CONSTRAINT "pos_tables_current_order_id_fkey" FOREIGN KEY (current_order_id) REFERENCES pos_orders(id);
ALTER TABLE ONLY "pos"."pos_wallet_transactions"
    ADD CONSTRAINT "pos_wallet_transactions_customer_id_fkey" FOREIGN KEY (customer_id) REFERENCES pos_customers(id);
ALTER TABLE ONLY "pos"."pos_wallet_transactions"
    ADD CONSTRAINT "pos_wallet_transactions_order_id_fkey" FOREIGN KEY (order_id) REFERENCES pos_orders(id);
ALTER TABLE ONLY "pos"."pos_xp_config"
    ADD CONSTRAINT "pos_xp_config_product_id_fkey" FOREIGN KEY (product_id) REFERENCES pos_products(id) ON DELETE CASCADE;
ALTER TABLE ONLY "pos"."pos_xp_transactions"
    ADD CONSTRAINT "pos_xp_transactions_customer_id_fkey" FOREIGN KEY (customer_id) REFERENCES pos_customers(id);
ALTER TABLE ONLY "pos"."pos_xp_transactions"
    ADD CONSTRAINT "pos_xp_transactions_order_id_fkey" FOREIGN KEY (order_id) REFERENCES pos_orders(id);
ALTER TABLE ONLY "hris"."positions"
    ADD CONSTRAINT "positions_brand_id_fkey" FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE CASCADE;
ALTER TABLE ONLY "purchasing"."pr_items"
    ADD CONSTRAINT "pr_items_pr_id_fkey" FOREIGN KEY (pr_id) REFERENCES purchase_requests(id) ON DELETE CASCADE NOT VALID;
ALTER TABLE ONLY "purchasing"."pr_items"
    ADD CONSTRAINT "pr_items_raw_material_id_fkey" FOREIGN KEY (raw_material_id) REFERENCES raw_materials(id) ON DELETE RESTRICT NOT VALID;
ALTER TABLE ONLY "purchasing"."pr_items"
    ADD CONSTRAINT "pr_items_satuan_id_fkey" FOREIGN KEY (satuan_id) REFERENCES units(id) ON DELETE SET NULL NOT VALID;
ALTER TABLE ONLY "manufacturing"."production_batches"
    ADD CONSTRAINT "production_batches_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id);
ALTER TABLE ONLY "manufacturing"."production_batches"
    ADD CONSTRAINT "production_batches_product_id_fkey" FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT;
ALTER TABLE ONLY "manufacturing"."production_batches"
    ADD CONSTRAINT "production_batches_production_order_id_fkey" FOREIGN KEY (production_order_id) REFERENCES production_orders(id) ON DELETE CASCADE;
ALTER TABLE ONLY "manufacturing"."production_batches"
    ADD CONSTRAINT "production_batches_wip_raw_material_id_fkey" FOREIGN KEY (wip_raw_material_id) REFERENCES raw_materials(id) ON DELETE SET NULL;
ALTER TABLE ONLY "manufacturing"."production_order_materials"
    ADD CONSTRAINT "production_order_materials_inventory_movement_id_fkey" FOREIGN KEY (inventory_movement_id) REFERENCES inventory_movements(id) ON DELETE SET NULL;
ALTER TABLE ONLY "manufacturing"."production_order_materials"
    ADD CONSTRAINT "production_order_materials_production_order_id_fkey" FOREIGN KEY (production_order_id) REFERENCES production_orders(id) ON DELETE CASCADE;
ALTER TABLE ONLY "manufacturing"."production_order_materials"
    ADD CONSTRAINT "production_order_materials_raw_material_id_fkey" FOREIGN KEY (raw_material_id) REFERENCES raw_materials(id) ON DELETE RESTRICT;
ALTER TABLE ONLY "manufacturing"."production_order_materials"
    ADD CONSTRAINT "production_order_materials_satuan_id_fkey" FOREIGN KEY (satuan_id) REFERENCES units(id) ON DELETE SET NULL;
ALTER TABLE ONLY "manufacturing"."production_orders"
    ADD CONSTRAINT "production_orders_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id);
ALTER TABLE ONLY "manufacturing"."production_orders"
    ADD CONSTRAINT "production_orders_product_id_fkey" FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT;
ALTER TABLE ONLY "manufacturing"."production_orders"
    ADD CONSTRAINT "production_orders_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES auth.users(id);
ALTER TABLE ONLY "item"."products"
    ADD CONSTRAINT "products_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id);
ALTER TABLE ONLY "item"."products"
    ADD CONSTRAINT "products_deleted_by_fkey" FOREIGN KEY (deleted_by) REFERENCES auth.users(id);
ALTER TABLE ONLY "item"."products"
    ADD CONSTRAINT "products_satuan_id_fkey" FOREIGN KEY (satuan_id) REFERENCES units(id);
ALTER TABLE ONLY "item"."products"
    ADD CONSTRAINT "products_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES auth.users(id);
ALTER TABLE ONLY "hris"."project_assignments"
    ADD CONSTRAINT "project_assignments_employee_id_fkey" FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE;
ALTER TABLE ONLY "hris"."project_assignments"
    ADD CONSTRAINT "project_assignments_review_id_fkey" FOREIGN KEY (review_id) REFERENCES performance_reviews(id) ON DELETE CASCADE;
ALTER TABLE ONLY "purchasing"."purchase_order_items"
    ADD CONSTRAINT "purchase_order_items_pr_item_id_fkey" FOREIGN KEY (pr_item_id) REFERENCES pr_items(id) ON DELETE SET NULL NOT VALID;
ALTER TABLE ONLY "purchasing"."purchase_order_items"
    ADD CONSTRAINT "purchase_order_items_purchase_order_id_fkey" FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id) ON DELETE CASCADE;
ALTER TABLE ONLY "purchasing"."purchase_order_items"
    ADD CONSTRAINT "purchase_order_items_raw_material_id_fkey" FOREIGN KEY (raw_material_id) REFERENCES raw_materials(id);
ALTER TABLE ONLY "purchasing"."purchase_order_items"
    ADD CONSTRAINT "purchase_order_items_satuan_id_fkey" FOREIGN KEY (satuan_id) REFERENCES units(id);
ALTER TABLE ONLY "purchasing"."purchase_order_payment_terms"
    ADD CONSTRAINT "purchase_order_payment_terms_purchase_order_id_fkey" FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id) ON DELETE CASCADE;
ALTER TABLE ONLY "purchasing"."purchase_order_payment_terms"
    ADD CONSTRAINT "purchase_order_payment_terms_supplier_id_fkey" FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE RESTRICT;
ALTER TABLE ONLY "purchasing"."purchase_orders"
    ADD CONSTRAINT "purchase_orders_approved_by_fkey" FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE ONLY "purchasing"."purchase_orders"
    ADD CONSTRAINT "purchase_orders_cancelled_by_fkey" FOREIGN KEY (cancelled_by) REFERENCES auth.users(id);
ALTER TABLE ONLY "purchasing"."purchase_orders"
    ADD CONSTRAINT "purchase_orders_created_by_fkey" FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE ONLY "purchasing"."purchase_orders"
    ADD CONSTRAINT "purchase_orders_pr_id_fkey" FOREIGN KEY (pr_id) REFERENCES purchase_requests(id) ON DELETE SET NULL NOT VALID;
ALTER TABLE ONLY "purchasing"."purchase_orders"
    ADD CONSTRAINT "purchase_orders_production_order_id_fkey" FOREIGN KEY (production_order_id) REFERENCES production_orders(id) ON DELETE SET NULL;
ALTER TABLE ONLY "purchasing"."purchase_orders"
    ADD CONSTRAINT "purchase_orders_sent_by_fkey" FOREIGN KEY (sent_by) REFERENCES auth.users(id);
ALTER TABLE ONLY "purchasing"."purchase_orders"
    ADD CONSTRAINT "purchase_orders_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE ONLY "purchasing"."purchase_requests"
    ADD CONSTRAINT "purchase_requests_converted_po_id_fkey" FOREIGN KEY (converted_po_id) REFERENCES purchase_orders(id) ON DELETE SET NULL NOT VALID;
ALTER TABLE ONLY "purchasing"."purchase_return_items"
    ADD CONSTRAINT "purchase_return_items_grn_item_id_fkey" FOREIGN KEY (grn_item_id) REFERENCES grn_items(id) ON DELETE SET NULL;
ALTER TABLE ONLY "purchasing"."purchase_return_items"
    ADD CONSTRAINT "purchase_return_items_raw_material_id_fkey" FOREIGN KEY (raw_material_id) REFERENCES raw_materials(id) ON DELETE RESTRICT;
ALTER TABLE ONLY "purchasing"."purchase_return_items"
    ADD CONSTRAINT "purchase_return_items_return_id_fkey" FOREIGN KEY (return_id) REFERENCES purchase_returns(id) ON DELETE CASCADE;
ALTER TABLE ONLY "purchasing"."purchase_returns"
    ADD CONSTRAINT "purchase_returns_approved_by_fkey" FOREIGN KEY (approved_by) REFERENCES staff(id) ON DELETE SET NULL;
ALTER TABLE ONLY "purchasing"."purchase_returns"
    ADD CONSTRAINT "purchase_returns_created_by_fkey" FOREIGN KEY (created_by) REFERENCES staff(id) ON DELETE SET NULL;
ALTER TABLE ONLY "purchasing"."purchase_returns"
    ADD CONSTRAINT "purchase_returns_grn_id_fkey" FOREIGN KEY (grn_id) REFERENCES grn(id) ON DELETE SET NULL;
ALTER TABLE ONLY "purchasing"."purchase_returns"
    ADD CONSTRAINT "purchase_returns_supplier_id_fkey" FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE RESTRICT;
ALTER TABLE ONLY "item"."raw_material_unit_conversions"
    ADD CONSTRAINT "raw_material_unit_conversions_raw_material_id_fkey" FOREIGN KEY (raw_material_id) REFERENCES raw_materials(id) ON DELETE CASCADE;
ALTER TABLE ONLY "item"."raw_material_unit_conversions"
    ADD CONSTRAINT "raw_material_unit_conversions_satuan_id_fkey" FOREIGN KEY (satuan_id) REFERENCES units(id);
ALTER TABLE ONLY "item"."raw_materials"
    ADD CONSTRAINT "raw_materials_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id);
ALTER TABLE ONLY "item"."raw_materials"
    ADD CONSTRAINT "raw_materials_deleted_by_fkey" FOREIGN KEY (deleted_by) REFERENCES auth.users(id);
ALTER TABLE ONLY "item"."raw_materials"
    ADD CONSTRAINT "raw_materials_satuan_besar_id_fkey" FOREIGN KEY (satuan_besar_id) REFERENCES units(id);
ALTER TABLE ONLY "item"."raw_materials"
    ADD CONSTRAINT "raw_materials_satuan_kecil_id_fkey" FOREIGN KEY (satuan_kecil_id) REFERENCES units(id);
ALTER TABLE ONLY "item"."raw_materials"
    ADD CONSTRAINT "raw_materials_source_product_id_fkey" FOREIGN KEY (source_product_id) REFERENCES products(id) ON DELETE SET NULL;
ALTER TABLE ONLY "item"."raw_materials"
    ADD CONSTRAINT "raw_materials_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES auth.users(id);
ALTER TABLE ONLY "hris"."sections"
    ADD CONSTRAINT "sections_brand_id_fkey" FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE CASCADE;
ALTER TABLE ONLY "hris"."staff"
    ADD CONSTRAINT "staff_brand_id_fkey" FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE CASCADE;
ALTER TABLE ONLY "hris"."staff"
    ADD CONSTRAINT "staff_position_id_fkey" FOREIGN KEY (position_id) REFERENCES positions(id) ON DELETE SET NULL;
ALTER TABLE ONLY "hris"."staff_schedules"
    ADD CONSTRAINT "staff_schedules_staff_id_fkey" FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE CASCADE;
ALTER TABLE ONLY "hris"."staff_sections"
    ADD CONSTRAINT "staff_sections_section_id_fkey" FOREIGN KEY (section_id) REFERENCES sections(id) ON DELETE CASCADE;
ALTER TABLE ONLY "hris"."staff_sections"
    ADD CONSTRAINT "staff_sections_staff_id_fkey" FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE CASCADE;
ALTER TABLE ONLY "purchasing"."supplier_price_lists"
    ADD CONSTRAINT "supplier_price_lists_bahan_baku_id_fkey" FOREIGN KEY (bahan_baku_id) REFERENCES raw_materials(id) ON DELETE CASCADE;
ALTER TABLE ONLY "purchasing"."supplier_price_lists"
    ADD CONSTRAINT "supplier_price_lists_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id);
ALTER TABLE ONLY "purchasing"."supplier_price_lists"
    ADD CONSTRAINT "supplier_price_lists_deleted_by_fkey" FOREIGN KEY (deleted_by) REFERENCES auth.users(id);
ALTER TABLE ONLY "purchasing"."supplier_price_lists"
    ADD CONSTRAINT "supplier_price_lists_satuan_id_fkey" FOREIGN KEY (satuan_id) REFERENCES units(id);
ALTER TABLE ONLY "purchasing"."supplier_price_lists"
    ADD CONSTRAINT "supplier_price_lists_supplier_id_fkey" FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE CASCADE;
ALTER TABLE ONLY "purchasing"."supplier_price_lists"
    ADD CONSTRAINT "supplier_price_lists_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES auth.users(id);
ALTER TABLE ONLY "purchasing"."suppliers"
    ADD CONSTRAINT "suppliers_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id);
ALTER TABLE ONLY "purchasing"."suppliers"
    ADD CONSTRAINT "suppliers_deleted_by_fkey" FOREIGN KEY (deleted_by) REFERENCES auth.users(id);
ALTER TABLE ONLY "purchasing"."suppliers"
    ADD CONSTRAINT "suppliers_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES auth.users(id);
ALTER TABLE ONLY "item"."units"
    ADD CONSTRAINT "units_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id);
ALTER TABLE ONLY "item"."units"
    ADD CONSTRAINT "units_deleted_by_fkey" FOREIGN KEY (deleted_by) REFERENCES auth.users(id);
ALTER TABLE ONLY "item"."units"
    ADD CONSTRAINT "units_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES auth.users(id);
ALTER TABLE ONLY "configuration"."user_approval_permissions"
    ADD CONSTRAINT "user_approval_permissions_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY "configuration"."user_approval_permissions"
    ADD CONSTRAINT "user_approval_permissions_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY "configuration"."user_approval_permissions"
    ADD CONSTRAINT "user_approval_permissions_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE ONLY "configuration"."users"
    ADD CONSTRAINT "users_brand_id_fkey" FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE SET NULL;
ALTER TABLE ONLY "configuration"."users"
    ADD CONSTRAINT "users_id_fkey" FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY "purchasing"."vendor_documents"
    ADD CONSTRAINT "vendor_documents_purchase_order_id_fkey" FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id) ON DELETE SET NULL;
ALTER TABLE ONLY "purchasing"."vendor_documents"
    ADD CONSTRAINT "vendor_documents_reviewed_by_fkey" FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE ONLY "purchasing"."vendor_documents"
    ADD CONSTRAINT "vendor_documents_supplier_id_fkey" FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL;
ALTER TABLE ONLY "purchasing"."vendor_documents"
    ADD CONSTRAINT "vendor_documents_uploaded_by_fkey" FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE ONLY "purchasing"."vendor_payments"
    ADD CONSTRAINT "vendor_payments_payment_term_id_fkey" FOREIGN KEY (payment_term_id) REFERENCES purchase_order_payment_terms(id) ON DELETE SET NULL;
ALTER TABLE ONLY "purchasing"."vendor_payments"
    ADD CONSTRAINT "vendor_payments_purchase_order_id_fkey" FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id) ON DELETE RESTRICT;
ALTER TABLE ONLY "purchasing"."vendor_payments"
    ADD CONSTRAINT "vendor_payments_supplier_id_fkey" FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE RESTRICT;
DO $$ BEGIN
    ALTER TABLE ONLY "purchasing"."vendor_credit_items"
        ADD CONSTRAINT "vendor_credit_items_vendor_credit_id_fkey" FOREIGN KEY (vendor_credit_id) REFERENCES vendor_credits(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE ONLY "purchasing"."vendor_credit_items"
        ADD CONSTRAINT "vendor_credit_items_grn_item_id_fkey" FOREIGN KEY (grn_item_id) REFERENCES grn_items(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE ONLY "purchasing"."vendor_credit_items"
        ADD CONSTRAINT "vendor_credit_items_raw_material_id_fkey" FOREIGN KEY (raw_material_id) REFERENCES raw_materials(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE ONLY "purchasing"."vendor_credits"
        ADD CONSTRAINT "vendor_credits_grn_id_fkey" FOREIGN KEY (grn_id) REFERENCES grn(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE ONLY "purchasing"."vendor_credits"
        ADD CONSTRAINT "vendor_credits_purchase_order_id_fkey" FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE ONLY "purchasing"."vendor_credits"
        ADD CONSTRAINT "vendor_credits_supplier_id_fkey" FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE ONLY "purchasing"."vendor_credits"
        ADD CONSTRAINT "vendor_credits_approved_by_fkey" FOREIGN KEY (approved_by) REFERENCES staff(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE ONLY "purchasing"."vendor_credits"
        ADD CONSTRAINT "vendor_credits_created_by_fkey" FOREIGN KEY (created_by) REFERENCES staff(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
