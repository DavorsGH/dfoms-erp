-- ============================================================================
-- 122_tier_rls_policies.sql
-- Davors ERP Suite - Tier-Based Feature Entitlement System (RLS enforcement)
--
-- Adds tenant_has_feature(tenant_id, 'feature_key') as an extra AND condition
-- to the RLS policies of every table that is exclusively owned by one gated
-- feature area, or safely gate-able on the lowest tier that needs it thanks
-- to tier nesting (every 'inventory'/'pos' tenant also has 'crm_core'; every
-- 'inventory' tenant also has 'operations').
--
-- Every existing USING/WITH CHECK expression is preserved EXACTLY as pulled
-- live from staging pg_policies (2026-07-27) - only "AND tenant_has_feature(
-- tenant_id, '<key>')" is appended. No existing logic is changed or removed.
--
-- Tables intentionally NOT touched (must stay accessible to every tier,
-- confirmed via code + business-logic review): customers, income_register,
-- expense_register, employees, payment_methods.
--
-- product_sale_payment_requests_super_admin_full_access is intentionally NOT
-- touched - it has no tenant_matches() clause at all (cross-tenant Davors
-- platform admin bypass), not a per-tenant customer access path.
--
-- Requires 121_tier_entitlement_system.sql to already be applied (defines
-- tenant_has_feature()).
--
-- Run on STAGING first. Do not run on production until staging is verified.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- operations: complaint_register, corrective_actions, failed_inspections,
-- incident_register, inspection_summary, operations_config, projects,
-- roster_config, roster_history, sites, work_orders
-- ----------------------------------------------------------------------------

-- complaint_register
ALTER POLICY complaint_register_rbac_delete ON complaint_register
  USING (tenant_matches(tenant_id) AND can_access_operations_site(site_id) AND tenant_has_feature(tenant_id, 'operations'));
ALTER POLICY complaint_register_rbac_insert ON complaint_register
  WITH CHECK (tenant_matches(tenant_id) AND can_access_operations_site(site_id) AND tenant_has_feature(tenant_id, 'operations'));
ALTER POLICY complaint_register_rbac_select ON complaint_register
  USING (tenant_matches(tenant_id) AND can_access_operations_site(site_id) AND tenant_has_feature(tenant_id, 'operations'));
ALTER POLICY complaint_register_rbac_update ON complaint_register
  USING (tenant_matches(tenant_id) AND can_access_operations_site(site_id) AND tenant_has_feature(tenant_id, 'operations'))
  WITH CHECK (tenant_matches(tenant_id) AND can_access_operations_site(site_id) AND tenant_has_feature(tenant_id, 'operations'));

-- corrective_actions
ALTER POLICY corrective_actions_rbac_delete ON corrective_actions
  USING (
    tenant_matches(tenant_id) AND (
      (current_user_role() = ANY (ARRAY['super_admin'::app_role, 'operations_manager'::app_role]))
      OR (
        (current_user_role() = 'supervisor'::app_role) AND (
          ((related_work_order IS NOT NULL) AND (EXISTS (
            SELECT 1 FROM work_orders wo
            WHERE ((wo.work_order_no = corrective_actions.related_work_order) AND tenant_matches(wo.tenant_id) AND can_access_operations_site(wo.site_id))
          )))
          OR ((related_issue_no IS NOT NULL) AND (EXISTS (
            SELECT 1 FROM failed_inspections fi
            WHERE ((fi.issue_no = corrective_actions.related_issue_no) AND tenant_matches(fi.tenant_id) AND can_access_operations_site(fi.site_id))
          )))
        )
      )
    )
    AND tenant_has_feature(tenant_id, 'operations')
  );
ALTER POLICY corrective_actions_rbac_insert ON corrective_actions
  WITH CHECK (
    tenant_matches(tenant_id) AND (
      (current_user_role() = ANY (ARRAY['super_admin'::app_role, 'operations_manager'::app_role]))
      OR (
        (current_user_role() = 'supervisor'::app_role) AND (
          ((related_work_order IS NOT NULL) AND (EXISTS (
            SELECT 1 FROM work_orders wo
            WHERE ((wo.work_order_no = corrective_actions.related_work_order) AND tenant_matches(wo.tenant_id) AND can_access_operations_site(wo.site_id))
          )))
          OR ((related_issue_no IS NOT NULL) AND (EXISTS (
            SELECT 1 FROM failed_inspections fi
            WHERE ((fi.issue_no = corrective_actions.related_issue_no) AND tenant_matches(fi.tenant_id) AND can_access_operations_site(fi.site_id))
          )))
        )
      )
    )
    AND tenant_has_feature(tenant_id, 'operations')
  );
ALTER POLICY corrective_actions_rbac_select ON corrective_actions
  USING (
    tenant_matches(tenant_id) AND (
      (current_user_role() = ANY (ARRAY['super_admin'::app_role, 'operations_manager'::app_role]))
      OR (
        (current_user_role() = 'supervisor'::app_role) AND (
          ((related_work_order IS NOT NULL) AND (EXISTS (
            SELECT 1 FROM work_orders wo
            WHERE ((wo.work_order_no = corrective_actions.related_work_order) AND tenant_matches(wo.tenant_id) AND can_access_operations_site(wo.site_id))
          )))
          OR ((related_issue_no IS NOT NULL) AND (EXISTS (
            SELECT 1 FROM failed_inspections fi
            WHERE ((fi.issue_no = corrective_actions.related_issue_no) AND tenant_matches(fi.tenant_id) AND can_access_operations_site(fi.site_id))
          )))
        )
      )
    )
    AND tenant_has_feature(tenant_id, 'operations')
  );
ALTER POLICY corrective_actions_rbac_update ON corrective_actions
  USING (
    tenant_matches(tenant_id) AND (
      (current_user_role() = ANY (ARRAY['super_admin'::app_role, 'operations_manager'::app_role]))
      OR (
        (current_user_role() = 'supervisor'::app_role) AND (
          ((related_work_order IS NOT NULL) AND (EXISTS (
            SELECT 1 FROM work_orders wo
            WHERE ((wo.work_order_no = corrective_actions.related_work_order) AND tenant_matches(wo.tenant_id) AND can_access_operations_site(wo.site_id))
          )))
          OR ((related_issue_no IS NOT NULL) AND (EXISTS (
            SELECT 1 FROM failed_inspections fi
            WHERE ((fi.issue_no = corrective_actions.related_issue_no) AND tenant_matches(fi.tenant_id) AND can_access_operations_site(fi.site_id))
          )))
        )
      )
    )
    AND tenant_has_feature(tenant_id, 'operations')
  )
  WITH CHECK (
    tenant_matches(tenant_id) AND (
      (current_user_role() = ANY (ARRAY['super_admin'::app_role, 'operations_manager'::app_role]))
      OR (
        (current_user_role() = 'supervisor'::app_role) AND (
          ((related_work_order IS NOT NULL) AND (EXISTS (
            SELECT 1 FROM work_orders wo
            WHERE ((wo.work_order_no = corrective_actions.related_work_order) AND tenant_matches(wo.tenant_id) AND can_access_operations_site(wo.site_id))
          )))
          OR ((related_issue_no IS NOT NULL) AND (EXISTS (
            SELECT 1 FROM failed_inspections fi
            WHERE ((fi.issue_no = corrective_actions.related_issue_no) AND tenant_matches(fi.tenant_id) AND can_access_operations_site(fi.site_id))
          )))
        )
      )
    )
    AND tenant_has_feature(tenant_id, 'operations')
  );

-- failed_inspections
ALTER POLICY failed_inspections_rbac_delete ON failed_inspections
  USING (tenant_matches(tenant_id) AND can_access_operations_site(site_id) AND tenant_has_feature(tenant_id, 'operations'));
ALTER POLICY failed_inspections_rbac_insert ON failed_inspections
  WITH CHECK (tenant_matches(tenant_id) AND can_access_operations_site(site_id) AND tenant_has_feature(tenant_id, 'operations'));
ALTER POLICY failed_inspections_rbac_select ON failed_inspections
  USING (tenant_matches(tenant_id) AND can_access_operations_site(site_id) AND tenant_has_feature(tenant_id, 'operations'));
ALTER POLICY failed_inspections_rbac_update ON failed_inspections
  USING (tenant_matches(tenant_id) AND can_access_operations_site(site_id) AND tenant_has_feature(tenant_id, 'operations'))
  WITH CHECK (tenant_matches(tenant_id) AND can_access_operations_site(site_id) AND tenant_has_feature(tenant_id, 'operations'));

-- incident_register
ALTER POLICY incident_register_rbac_delete ON incident_register
  USING (tenant_matches(tenant_id) AND can_access_operations_site(site_id) AND tenant_has_feature(tenant_id, 'operations'));
ALTER POLICY incident_register_rbac_insert ON incident_register
  WITH CHECK (tenant_matches(tenant_id) AND can_access_operations_site(site_id) AND tenant_has_feature(tenant_id, 'operations'));
ALTER POLICY incident_register_rbac_select ON incident_register
  USING (tenant_matches(tenant_id) AND can_access_operations_site(site_id) AND tenant_has_feature(tenant_id, 'operations'));
ALTER POLICY incident_register_rbac_update ON incident_register
  USING (tenant_matches(tenant_id) AND can_access_operations_site(site_id) AND tenant_has_feature(tenant_id, 'operations'))
  WITH CHECK (tenant_matches(tenant_id) AND can_access_operations_site(site_id) AND tenant_has_feature(tenant_id, 'operations'));

-- inspection_summary
ALTER POLICY inspection_summary_rbac_delete ON inspection_summary
  USING (tenant_matches(tenant_id) AND can_access_operations_site(site_id) AND tenant_has_feature(tenant_id, 'operations'));
ALTER POLICY inspection_summary_rbac_insert ON inspection_summary
  WITH CHECK (tenant_matches(tenant_id) AND can_access_operations_site(site_id) AND tenant_has_feature(tenant_id, 'operations'));
ALTER POLICY inspection_summary_rbac_select ON inspection_summary
  USING (tenant_matches(tenant_id) AND can_access_operations_site(site_id) AND tenant_has_feature(tenant_id, 'operations'));
ALTER POLICY inspection_summary_rbac_update ON inspection_summary
  USING (tenant_matches(tenant_id) AND can_access_operations_site(site_id) AND tenant_has_feature(tenant_id, 'operations'))
  WITH CHECK (tenant_matches(tenant_id) AND can_access_operations_site(site_id) AND tenant_has_feature(tenant_id, 'operations'));

-- operations_config
ALTER POLICY operations_config_tenant_delete ON operations_config
  USING (tenant_matches(tenant_id) AND tenant_has_feature(tenant_id, 'operations'));
ALTER POLICY operations_config_tenant_insert ON operations_config
  WITH CHECK (tenant_matches(tenant_id) AND tenant_has_feature(tenant_id, 'operations'));
ALTER POLICY operations_config_tenant_select ON operations_config
  USING (tenant_matches(tenant_id) AND tenant_has_feature(tenant_id, 'operations'));
ALTER POLICY operations_config_tenant_update ON operations_config
  USING (tenant_matches(tenant_id) AND tenant_has_feature(tenant_id, 'operations'))
  WITH CHECK (tenant_matches(tenant_id) AND tenant_has_feature(tenant_id, 'operations'));

-- projects
ALTER POLICY projects_admin_write ON projects
  USING (tenant_matches(tenant_id) AND is_super_admin() AND tenant_has_feature(tenant_id, 'operations'))
  WITH CHECK (tenant_matches(tenant_id) AND is_super_admin() AND tenant_has_feature(tenant_id, 'operations'));
ALTER POLICY projects_client_select ON projects
  USING (
    tenant_matches(tenant_id) AND (
      is_super_admin()
      OR (current_user_role() = ANY (ARRAY['finance'::app_role, 'hr'::app_role, 'operations_manager'::app_role, 'supervisor'::app_role]))
      OR (EXISTS (
        SELECT 1 FROM sites s
        WHERE ((s.project_id = projects.id) AND tenant_matches(s.tenant_id) AND (s.client_id = current_user_client_id()) AND (current_user_role() = 'client'::app_role))
      ))
    )
    AND tenant_has_feature(tenant_id, 'operations')
  );

-- roster_config
ALTER POLICY roster_config_client_select ON roster_config
  USING (
    tenant_matches(tenant_id) AND (
      is_super_admin()
      OR (current_user_role() = ANY (ARRAY['operations_manager'::app_role, 'supervisor'::app_role]))
      OR can_access_client_record(client_id)
    )
    AND tenant_has_feature(tenant_id, 'operations')
  );
ALTER POLICY roster_config_ops_write ON roster_config
  USING (tenant_matches(tenant_id) AND (current_user_role() = ANY (ARRAY['super_admin'::app_role, 'operations_manager'::app_role])) AND tenant_has_feature(tenant_id, 'operations'))
  WITH CHECK (tenant_matches(tenant_id) AND (current_user_role() = ANY (ARRAY['super_admin'::app_role, 'operations_manager'::app_role])) AND tenant_has_feature(tenant_id, 'operations'));

-- roster_history
ALTER POLICY roster_history_rbac_delete ON roster_history
  USING (
    tenant_matches(tenant_id) AND (
      (current_user_role() = ANY (ARRAY['super_admin'::app_role, 'operations_manager'::app_role]))
      OR (
        (current_user_role() = 'supervisor'::app_role) AND (employee_id IS NOT NULL) AND can_access_employee_record((
          SELECT e.assigned_site_id FROM employees e
          WHERE ((e.employee_id = roster_history.employee_id) AND tenant_matches(e.tenant_id))
        ))
      )
    )
    AND tenant_has_feature(tenant_id, 'operations')
  );
ALTER POLICY roster_history_rbac_insert ON roster_history
  WITH CHECK (
    tenant_matches(tenant_id) AND (
      (current_user_role() = ANY (ARRAY['super_admin'::app_role, 'operations_manager'::app_role]))
      OR (
        (current_user_role() = 'supervisor'::app_role) AND (employee_id IS NOT NULL) AND can_access_employee_record((
          SELECT e.assigned_site_id FROM employees e
          WHERE ((e.employee_id = roster_history.employee_id) AND tenant_matches(e.tenant_id))
        ))
      )
    )
    AND tenant_has_feature(tenant_id, 'operations')
  );
ALTER POLICY roster_history_rbac_select ON roster_history
  USING (
    tenant_matches(tenant_id) AND (
      (current_user_role() = ANY (ARRAY['super_admin'::app_role, 'operations_manager'::app_role, 'hr'::app_role]))
      OR (current_user_role() = 'supervisor'::app_role)
      OR (employee_id = current_user_employee_id())
    )
    AND tenant_has_feature(tenant_id, 'operations')
  );
ALTER POLICY roster_history_rbac_update ON roster_history
  USING (
    tenant_matches(tenant_id) AND (
      (current_user_role() = ANY (ARRAY['super_admin'::app_role, 'operations_manager'::app_role]))
      OR (
        (current_user_role() = 'supervisor'::app_role) AND (employee_id IS NOT NULL) AND can_access_employee_record((
          SELECT e.assigned_site_id FROM employees e
          WHERE ((e.employee_id = roster_history.employee_id) AND tenant_matches(e.tenant_id))
        ))
      )
    )
    AND tenant_has_feature(tenant_id, 'operations')
  )
  WITH CHECK (
    tenant_matches(tenant_id) AND (
      (current_user_role() = ANY (ARRAY['super_admin'::app_role, 'operations_manager'::app_role]))
      OR (
        (current_user_role() = 'supervisor'::app_role) AND (employee_id IS NOT NULL) AND can_access_employee_record((
          SELECT e.assigned_site_id FROM employees e
          WHERE ((e.employee_id = roster_history.employee_id) AND tenant_matches(e.tenant_id))
        ))
      )
    )
    AND tenant_has_feature(tenant_id, 'operations')
  );

-- sites
ALTER POLICY sites_rbac_select ON sites
  USING (
    tenant_matches(tenant_id) AND (
      (current_user_role() = ANY (ARRAY['super_admin'::app_role, 'operations_manager'::app_role]))
      OR ((current_user_role() = 'supervisor'::app_role) AND (site_code IN (SELECT current_user_supervisor_site_codes() AS current_user_supervisor_site_codes)))
      OR (current_user_role() = ANY (ARRAY['finance'::app_role, 'hr'::app_role]))
      OR ((current_user_role() = 'client'::app_role) AND (client_id = current_user_client_id()))
    )
    AND tenant_has_feature(tenant_id, 'operations')
  );
ALTER POLICY sites_rbac_write ON sites
  USING (tenant_matches(tenant_id) AND (current_user_role() = ANY (ARRAY['super_admin'::app_role, 'operations_manager'::app_role])) AND tenant_has_feature(tenant_id, 'operations'))
  WITH CHECK (tenant_matches(tenant_id) AND (current_user_role() = ANY (ARRAY['super_admin'::app_role, 'operations_manager'::app_role])) AND tenant_has_feature(tenant_id, 'operations'));

-- work_orders
ALTER POLICY work_orders_rbac_delete ON work_orders
  USING (tenant_matches(tenant_id) AND can_access_operations_site(site_id) AND tenant_has_feature(tenant_id, 'operations'));
ALTER POLICY work_orders_rbac_insert ON work_orders
  WITH CHECK (tenant_matches(tenant_id) AND can_access_operations_site(site_id) AND tenant_has_feature(tenant_id, 'operations'));
ALTER POLICY work_orders_rbac_select ON work_orders
  USING (tenant_matches(tenant_id) AND can_access_operations_site(site_id) AND tenant_has_feature(tenant_id, 'operations'));
ALTER POLICY work_orders_rbac_update ON work_orders
  USING (tenant_matches(tenant_id) AND can_access_operations_site(site_id) AND tenant_has_feature(tenant_id, 'operations'))
  WITH CHECK (tenant_matches(tenant_id) AND can_access_operations_site(site_id) AND tenant_has_feature(tenant_id, 'operations'));

-- ----------------------------------------------------------------------------
-- crm_core: crm_products, crm_sales, finished_products, stock_movements
-- ----------------------------------------------------------------------------

ALTER POLICY tenant_isolation_crm_products ON crm_products
  USING (tenant_id = current_user_tenant_id() AND tenant_has_feature(tenant_id, 'crm_core'))
  WITH CHECK (tenant_id = current_user_tenant_id() AND tenant_has_feature(tenant_id, 'crm_core'));

ALTER POLICY tenant_isolation_crm_sales ON crm_sales
  USING (tenant_id = current_user_tenant_id() AND tenant_has_feature(tenant_id, 'crm_core'))
  WITH CHECK (tenant_id = current_user_tenant_id() AND tenant_has_feature(tenant_id, 'crm_core'));

ALTER POLICY finished_products_tenant_delete ON finished_products
  USING (tenant_matches(tenant_id) AND tenant_has_feature(tenant_id, 'crm_core'));
ALTER POLICY finished_products_tenant_insert ON finished_products
  WITH CHECK (tenant_matches(tenant_id) AND tenant_has_feature(tenant_id, 'crm_core'));
ALTER POLICY finished_products_tenant_select ON finished_products
  USING (tenant_matches(tenant_id) AND tenant_has_feature(tenant_id, 'crm_core'));
ALTER POLICY finished_products_tenant_update ON finished_products
  USING (tenant_matches(tenant_id) AND tenant_has_feature(tenant_id, 'crm_core'))
  WITH CHECK (tenant_matches(tenant_id) AND tenant_has_feature(tenant_id, 'crm_core'));

ALTER POLICY stock_movements_tenant_delete ON stock_movements
  USING (tenant_matches(tenant_id) AND tenant_has_feature(tenant_id, 'crm_core'));
ALTER POLICY stock_movements_tenant_insert ON stock_movements
  WITH CHECK (tenant_matches(tenant_id) AND tenant_has_feature(tenant_id, 'crm_core'));
ALTER POLICY stock_movements_tenant_select ON stock_movements
  USING (tenant_matches(tenant_id) AND tenant_has_feature(tenant_id, 'crm_core'));
ALTER POLICY stock_movements_tenant_update ON stock_movements
  USING (tenant_matches(tenant_id) AND tenant_has_feature(tenant_id, 'crm_core'))
  WITH CHECK (tenant_matches(tenant_id) AND tenant_has_feature(tenant_id, 'crm_core'));

-- ----------------------------------------------------------------------------
-- pos: product_sale_payment_requests (tenant-scoped policies only -
-- product_sale_payment_requests_super_admin_full_access left untouched)
-- ----------------------------------------------------------------------------

ALTER POLICY product_sale_payment_requests_tenant_delete ON product_sale_payment_requests
  USING (tenant_matches(tenant_id) AND tenant_has_feature(tenant_id, 'pos'));
ALTER POLICY product_sale_payment_requests_tenant_insert ON product_sale_payment_requests
  WITH CHECK (tenant_matches(tenant_id) AND tenant_has_feature(tenant_id, 'pos'));
ALTER POLICY product_sale_payment_requests_tenant_select ON product_sale_payment_requests
  USING (tenant_matches(tenant_id) AND tenant_has_feature(tenant_id, 'pos'));
ALTER POLICY product_sale_payment_requests_tenant_update ON product_sale_payment_requests
  USING (tenant_matches(tenant_id) AND tenant_has_feature(tenant_id, 'pos'))
  WITH CHECK (tenant_matches(tenant_id) AND tenant_has_feature(tenant_id, 'pos'));

-- ----------------------------------------------------------------------------
-- inventory: internal_consumption, product_purchases, production_batch_materials,
-- production_batches, purchase_order_items, purchase_orders,
-- raw_material_purchases, raw_materials, suppliers
-- ----------------------------------------------------------------------------

ALTER POLICY internal_consumption_tenant_delete ON internal_consumption
  USING (tenant_matches(tenant_id) AND tenant_has_feature(tenant_id, 'inventory'));
ALTER POLICY internal_consumption_tenant_insert ON internal_consumption
  WITH CHECK (tenant_matches(tenant_id) AND tenant_has_feature(tenant_id, 'inventory'));
ALTER POLICY internal_consumption_tenant_select ON internal_consumption
  USING (tenant_matches(tenant_id) AND tenant_has_feature(tenant_id, 'inventory'));
ALTER POLICY internal_consumption_tenant_update ON internal_consumption
  USING (tenant_matches(tenant_id) AND tenant_has_feature(tenant_id, 'inventory'))
  WITH CHECK (tenant_matches(tenant_id) AND tenant_has_feature(tenant_id, 'inventory'));

ALTER POLICY product_purchases_tenant_delete ON product_purchases
  USING (tenant_matches(tenant_id) AND tenant_has_feature(tenant_id, 'inventory'));
ALTER POLICY product_purchases_tenant_insert ON product_purchases
  WITH CHECK (tenant_matches(tenant_id) AND tenant_has_feature(tenant_id, 'inventory'));
ALTER POLICY product_purchases_tenant_select ON product_purchases
  USING (tenant_matches(tenant_id) AND tenant_has_feature(tenant_id, 'inventory'));
ALTER POLICY product_purchases_tenant_update ON product_purchases
  USING (tenant_matches(tenant_id) AND tenant_has_feature(tenant_id, 'inventory'))
  WITH CHECK (tenant_matches(tenant_id) AND tenant_has_feature(tenant_id, 'inventory'));

ALTER POLICY production_batch_materials_tenant_delete ON production_batch_materials
  USING (tenant_matches(tenant_id) AND tenant_has_feature(tenant_id, 'inventory'));
ALTER POLICY production_batch_materials_tenant_insert ON production_batch_materials
  WITH CHECK (tenant_matches(tenant_id) AND tenant_has_feature(tenant_id, 'inventory'));
ALTER POLICY production_batch_materials_tenant_select ON production_batch_materials
  USING (tenant_matches(tenant_id) AND tenant_has_feature(tenant_id, 'inventory'));
ALTER POLICY production_batch_materials_tenant_update ON production_batch_materials
  USING (tenant_matches(tenant_id) AND tenant_has_feature(tenant_id, 'inventory'))
  WITH CHECK (tenant_matches(tenant_id) AND tenant_has_feature(tenant_id, 'inventory'));

ALTER POLICY production_batches_tenant_delete ON production_batches
  USING (tenant_matches(tenant_id) AND tenant_has_feature(tenant_id, 'inventory'));
ALTER POLICY production_batches_tenant_insert ON production_batches
  WITH CHECK (tenant_matches(tenant_id) AND tenant_has_feature(tenant_id, 'inventory'));
ALTER POLICY production_batches_tenant_select ON production_batches
  USING (tenant_matches(tenant_id) AND tenant_has_feature(tenant_id, 'inventory'));
ALTER POLICY production_batches_tenant_update ON production_batches
  USING (tenant_matches(tenant_id) AND tenant_has_feature(tenant_id, 'inventory'))
  WITH CHECK (tenant_matches(tenant_id) AND tenant_has_feature(tenant_id, 'inventory'));

ALTER POLICY purchase_order_items_tenant_delete ON purchase_order_items
  USING (tenant_matches(tenant_id) AND tenant_has_feature(tenant_id, 'inventory'));
ALTER POLICY purchase_order_items_tenant_insert ON purchase_order_items
  WITH CHECK (tenant_matches(tenant_id) AND tenant_has_feature(tenant_id, 'inventory'));
ALTER POLICY purchase_order_items_tenant_select ON purchase_order_items
  USING (tenant_matches(tenant_id) AND tenant_has_feature(tenant_id, 'inventory'));
ALTER POLICY purchase_order_items_tenant_update ON purchase_order_items
  USING (tenant_matches(tenant_id) AND tenant_has_feature(tenant_id, 'inventory'))
  WITH CHECK (tenant_matches(tenant_id) AND tenant_has_feature(tenant_id, 'inventory'));

ALTER POLICY purchase_orders_tenant_delete ON purchase_orders
  USING (tenant_matches(tenant_id) AND tenant_has_feature(tenant_id, 'inventory'));
ALTER POLICY purchase_orders_tenant_insert ON purchase_orders
  WITH CHECK (tenant_matches(tenant_id) AND tenant_has_feature(tenant_id, 'inventory'));
ALTER POLICY purchase_orders_tenant_select ON purchase_orders
  USING (tenant_matches(tenant_id) AND tenant_has_feature(tenant_id, 'inventory'));
ALTER POLICY purchase_orders_tenant_update ON purchase_orders
  USING (tenant_matches(tenant_id) AND tenant_has_feature(tenant_id, 'inventory'))
  WITH CHECK (tenant_matches(tenant_id) AND tenant_has_feature(tenant_id, 'inventory'));

ALTER POLICY raw_material_purchases_tenant_delete ON raw_material_purchases
  USING (tenant_matches(tenant_id) AND tenant_has_feature(tenant_id, 'inventory'));
ALTER POLICY raw_material_purchases_tenant_insert ON raw_material_purchases
  WITH CHECK (tenant_matches(tenant_id) AND tenant_has_feature(tenant_id, 'inventory'));
ALTER POLICY raw_material_purchases_tenant_select ON raw_material_purchases
  USING (tenant_matches(tenant_id) AND tenant_has_feature(tenant_id, 'inventory'));
ALTER POLICY raw_material_purchases_tenant_update ON raw_material_purchases
  USING (tenant_matches(tenant_id) AND tenant_has_feature(tenant_id, 'inventory'))
  WITH CHECK (tenant_matches(tenant_id) AND tenant_has_feature(tenant_id, 'inventory'));

ALTER POLICY raw_materials_tenant_delete ON raw_materials
  USING (tenant_matches(tenant_id) AND tenant_has_feature(tenant_id, 'inventory'));
ALTER POLICY raw_materials_tenant_insert ON raw_materials
  WITH CHECK (tenant_matches(tenant_id) AND tenant_has_feature(tenant_id, 'inventory'));
ALTER POLICY raw_materials_tenant_select ON raw_materials
  USING (tenant_matches(tenant_id) AND tenant_has_feature(tenant_id, 'inventory'));
ALTER POLICY raw_materials_tenant_update ON raw_materials
  USING (tenant_matches(tenant_id) AND tenant_has_feature(tenant_id, 'inventory'))
  WITH CHECK (tenant_matches(tenant_id) AND tenant_has_feature(tenant_id, 'inventory'));

ALTER POLICY suppliers_tenant_delete ON suppliers
  USING (tenant_matches(tenant_id) AND tenant_has_feature(tenant_id, 'inventory'));
ALTER POLICY suppliers_tenant_insert ON suppliers
  WITH CHECK (tenant_matches(tenant_id) AND tenant_has_feature(tenant_id, 'inventory'));
ALTER POLICY suppliers_tenant_select ON suppliers
  USING (tenant_matches(tenant_id) AND tenant_has_feature(tenant_id, 'inventory'));
ALTER POLICY suppliers_tenant_update ON suppliers
  USING (tenant_matches(tenant_id) AND tenant_has_feature(tenant_id, 'inventory'))
  WITH CHECK (tenant_matches(tenant_id) AND tenant_has_feature(tenant_id, 'inventory'));

-- ----------------------------------------------------------------------------
-- email_promotions: campaign_recipients, campaigns, customer_comm_preferences,
-- message_templates, transactional_notification_rules
-- ----------------------------------------------------------------------------

ALTER POLICY campaign_recipients_tenant_all ON campaign_recipients
  USING (tenant_matches(tenant_id) AND tenant_has_feature(tenant_id, 'email_promotions'))
  WITH CHECK (tenant_matches(tenant_id) AND tenant_has_feature(tenant_id, 'email_promotions'));

ALTER POLICY campaigns_tenant_all ON campaigns
  USING (tenant_matches(tenant_id) AND tenant_has_feature(tenant_id, 'email_promotions'))
  WITH CHECK (tenant_matches(tenant_id) AND tenant_has_feature(tenant_id, 'email_promotions'));

ALTER POLICY customer_comm_preferences_tenant_all ON customer_comm_preferences
  USING (tenant_matches(tenant_id) AND tenant_has_feature(tenant_id, 'email_promotions'))
  WITH CHECK (tenant_matches(tenant_id) AND tenant_has_feature(tenant_id, 'email_promotions'));

ALTER POLICY message_templates_tenant_all ON message_templates
  USING (tenant_matches(tenant_id) AND tenant_has_feature(tenant_id, 'email_promotions'))
  WITH CHECK (tenant_matches(tenant_id) AND tenant_has_feature(tenant_id, 'email_promotions'));

ALTER POLICY transactional_notification_rules_tenant_all ON transactional_notification_rules
  USING (tenant_matches(tenant_id) AND tenant_has_feature(tenant_id, 'email_promotions'))
  WITH CHECK (tenant_matches(tenant_id) AND tenant_has_feature(tenant_id, 'email_promotions'));

-- ============================================================================
-- IMPORTANT CAVEAT ON email_promotions: transactional (non-marketing) sale/
-- payment/invoice notifications (Phase 7 Step 5) are supposed to be
-- best-effort/non-blocking and should NOT depend on the Enterprise tier -
-- verify with Cursor whether transactional_notification_rules firing from
-- POS/product-sale/invoice creation runs as the calling user (subject to this
-- new RLS gate) or via a service-role/SECURITY DEFINER path (bypasses it) -
-- BEFORE running this on production. If it runs as the calling user, a
-- non-Enterprise tenant's transactional notifications would silently stop
-- firing, which was not the intent of gating email_promotions.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Verification (single combined query)
-- ----------------------------------------------------------------------------
SELECT tablename || '.' || policyname AS policy,
       CASE WHEN qual::text LIKE '%tenant_has_feature%' OR with_check::text LIKE '%tenant_has_feature%'
            THEN 'OK' ELSE 'MISSING' END AS status
FROM pg_policies
WHERE tablename IN (
  'complaint_register','corrective_actions','failed_inspections','incident_register',
  'inspection_summary','operations_config','projects','roster_config','roster_history',
  'sites','work_orders',
  'crm_products','crm_sales','finished_products','stock_movements',
  'product_sale_payment_requests',
  'internal_consumption','product_purchases','production_batch_materials',
  'production_batches','purchase_order_items','purchase_orders',
  'raw_material_purchases','raw_materials','suppliers',
  'campaign_recipients','campaigns','customer_comm_preferences',
  'message_templates','transactional_notification_rules'
)
AND policyname != 'product_sale_payment_requests_super_admin_full_access'
ORDER BY tablename, policyname;
