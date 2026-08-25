BEGIN;

ALTER TABLE public.facility_manager_property_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS facility_manager_property_assignments_tenant_select ON public.facility_manager_property_assignments;
CREATE POLICY facility_manager_property_assignments_tenant_select
  ON public.facility_manager_property_assignments
  FOR SELECT
  TO authenticated
  USING (public.tenant_matches(tenant_id));

DROP POLICY IF EXISTS facility_manager_property_assignments_tenant_insert ON public.facility_manager_property_assignments;
CREATE POLICY facility_manager_property_assignments_tenant_insert
  ON public.facility_manager_property_assignments
  FOR INSERT
  TO authenticated
  WITH CHECK (public.tenant_matches(tenant_id));

DROP POLICY IF EXISTS facility_manager_property_assignments_tenant_update ON public.facility_manager_property_assignments;
CREATE POLICY facility_manager_property_assignments_tenant_update
  ON public.facility_manager_property_assignments
  FOR UPDATE
  TO authenticated
  USING (public.tenant_matches(tenant_id))
  WITH CHECK (public.tenant_matches(tenant_id));

DROP POLICY IF EXISTS facility_manager_property_assignments_tenant_delete ON public.facility_manager_property_assignments;
CREATE POLICY facility_manager_property_assignments_tenant_delete
  ON public.facility_manager_property_assignments
  FOR DELETE
  TO authenticated
  USING (public.tenant_matches(tenant_id));

DROP POLICY IF EXISTS landlord_portal_manage_fm_property_assignments ON public.facility_manager_property_assignments;
CREATE POLICY landlord_portal_manage_fm_property_assignments
  ON public.facility_manager_property_assignments
  FOR ALL
  TO authenticated
  USING (tenant_id = public.current_user_landlord_tenant_id())
  WITH CHECK (tenant_id = public.current_user_landlord_tenant_id());

DROP POLICY IF EXISTS facility_portal_select_own_property_assignments ON public.facility_manager_property_assignments;
CREATE POLICY facility_portal_select_own_property_assignments
  ON public.facility_manager_property_assignments
  FOR SELECT
  TO authenticated
  USING (
    tenant_id = public.current_user_facility_manager_tenant_id()
    AND facility_manager_id = public.current_user_facility_manager_id()
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.facility_manager_property_assignments TO authenticated;
GRANT ALL ON TABLE public.facility_manager_property_assignments TO service_role;

ALTER TABLE public.facility_manager_portal_invites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS facility_manager_portal_invites_service_role_all ON public.facility_manager_portal_invites;
CREATE POLICY facility_manager_portal_invites_service_role_all
  ON public.facility_manager_portal_invites
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS facility_manager_portal_invites_tenant_select ON public.facility_manager_portal_invites;
CREATE POLICY facility_manager_portal_invites_tenant_select
  ON public.facility_manager_portal_invites
  FOR SELECT
  TO authenticated
  USING (public.tenant_matches(tenant_id));

DROP POLICY IF EXISTS facility_manager_portal_invites_tenant_insert ON public.facility_manager_portal_invites;
CREATE POLICY facility_manager_portal_invites_tenant_insert
  ON public.facility_manager_portal_invites
  FOR INSERT
  TO authenticated
  WITH CHECK (public.tenant_matches(tenant_id));

DROP POLICY IF EXISTS facility_manager_portal_invites_tenant_update ON public.facility_manager_portal_invites;
CREATE POLICY facility_manager_portal_invites_tenant_update
  ON public.facility_manager_portal_invites
  FOR UPDATE
  TO authenticated
  USING (public.tenant_matches(tenant_id))
  WITH CHECK (public.tenant_matches(tenant_id));

DROP POLICY IF EXISTS facility_manager_portal_invites_tenant_delete ON public.facility_manager_portal_invites;
CREATE POLICY facility_manager_portal_invites_tenant_delete
  ON public.facility_manager_portal_invites
  FOR DELETE
  TO authenticated
  USING (public.tenant_matches(tenant_id));

DROP POLICY IF EXISTS landlord_portal_manage_fm_portal_invites ON public.facility_manager_portal_invites;
CREATE POLICY landlord_portal_manage_fm_portal_invites
  ON public.facility_manager_portal_invites
  FOR ALL
  TO authenticated
  USING (tenant_id = public.current_user_landlord_tenant_id())
  WITH CHECK (tenant_id = public.current_user_landlord_tenant_id());

DROP POLICY IF EXISTS facility_portal_select_own_portal_invites ON public.facility_manager_portal_invites;
CREATE POLICY facility_portal_select_own_portal_invites
  ON public.facility_manager_portal_invites
  FOR SELECT
  TO authenticated
  USING (
    tenant_id = public.current_user_facility_manager_tenant_id()
    AND facility_manager_id = public.current_user_facility_manager_id()
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.facility_manager_portal_invites TO authenticated;
GRANT ALL ON TABLE public.facility_manager_portal_invites TO service_role;

ALTER TABLE public.facility_manager_collections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS facility_manager_collections_tenant_select ON public.facility_manager_collections;
CREATE POLICY facility_manager_collections_tenant_select
  ON public.facility_manager_collections
  FOR SELECT
  TO authenticated
  USING (public.tenant_matches(tenant_id));

DROP POLICY IF EXISTS facility_manager_collections_tenant_insert ON public.facility_manager_collections;
CREATE POLICY facility_manager_collections_tenant_insert
  ON public.facility_manager_collections
  FOR INSERT
  TO authenticated
  WITH CHECK (public.tenant_matches(tenant_id));

DROP POLICY IF EXISTS facility_manager_collections_tenant_update ON public.facility_manager_collections;
CREATE POLICY facility_manager_collections_tenant_update
  ON public.facility_manager_collections
  FOR UPDATE
  TO authenticated
  USING (public.tenant_matches(tenant_id))
  WITH CHECK (public.tenant_matches(tenant_id));

DROP POLICY IF EXISTS facility_manager_collections_tenant_delete ON public.facility_manager_collections;
CREATE POLICY facility_manager_collections_tenant_delete
  ON public.facility_manager_collections
  FOR DELETE
  TO authenticated
  USING (public.tenant_matches(tenant_id));

DROP POLICY IF EXISTS landlord_portal_manage_fm_collections ON public.facility_manager_collections;
CREATE POLICY landlord_portal_manage_fm_collections
  ON public.facility_manager_collections
  FOR ALL
  TO authenticated
  USING (tenant_id = public.current_user_landlord_tenant_id())
  WITH CHECK (tenant_id = public.current_user_landlord_tenant_id());

DROP POLICY IF EXISTS facility_portal_select_own_collections ON public.facility_manager_collections;
CREATE POLICY facility_portal_select_own_collections
  ON public.facility_manager_collections
  FOR SELECT
  TO authenticated
  USING (
    tenant_id = public.current_user_facility_manager_tenant_id()
    AND facility_manager_id = public.current_user_facility_manager_id()
    AND public.facility_manager_has_property(property_id)
  );

DROP POLICY IF EXISTS facility_portal_insert_own_collections ON public.facility_manager_collections;
CREATE POLICY facility_portal_insert_own_collections
  ON public.facility_manager_collections
  FOR INSERT
  TO authenticated
  WITH CHECK (
    tenant_id = public.current_user_facility_manager_tenant_id()
    AND facility_manager_id = public.current_user_facility_manager_id()
    AND public.facility_manager_has_property(property_id)
    AND EXISTS (
      SELECT 1
      FROM public.facility_managers fm
      WHERE fm.facility_manager_id = public.current_user_facility_manager_id()
        AND fm.tenant_id = public.current_user_facility_manager_tenant_id()
        AND fm.status = 'active'
        AND (
          fm.can_collect_rent IS TRUE
          OR fm.can_collect_charges IS TRUE
        )
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.facility_manager_collections TO authenticated;
GRANT ALL ON TABLE public.facility_manager_collections TO service_role;

ALTER TABLE public.property_service_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS property_service_records_tenant_select ON public.property_service_records;
CREATE POLICY property_service_records_tenant_select
  ON public.property_service_records
  FOR SELECT
  TO authenticated
  USING (public.tenant_matches(tenant_id));

DROP POLICY IF EXISTS property_service_records_tenant_insert ON public.property_service_records;
CREATE POLICY property_service_records_tenant_insert
  ON public.property_service_records
  FOR INSERT
  TO authenticated
  WITH CHECK (public.tenant_matches(tenant_id));

DROP POLICY IF EXISTS property_service_records_tenant_update ON public.property_service_records;
CREATE POLICY property_service_records_tenant_update
  ON public.property_service_records
  FOR UPDATE
  TO authenticated
  USING (public.tenant_matches(tenant_id))
  WITH CHECK (public.tenant_matches(tenant_id));

DROP POLICY IF EXISTS property_service_records_tenant_delete ON public.property_service_records;
CREATE POLICY property_service_records_tenant_delete
  ON public.property_service_records
  FOR DELETE
  TO authenticated
  USING (public.tenant_matches(tenant_id));

DROP POLICY IF EXISTS landlord_portal_manage_property_service_records ON public.property_service_records;
CREATE POLICY landlord_portal_manage_property_service_records
  ON public.property_service_records
  FOR ALL
  TO authenticated
  USING (tenant_id = public.current_user_landlord_tenant_id())
  WITH CHECK (tenant_id = public.current_user_landlord_tenant_id());

DROP POLICY IF EXISTS facility_portal_select_assigned_service_records ON public.property_service_records;
CREATE POLICY facility_portal_select_assigned_service_records
  ON public.property_service_records
  FOR SELECT
  TO authenticated
  USING (
    tenant_id = public.current_user_facility_manager_tenant_id()
    AND public.facility_manager_has_property(property_id)
  );

DROP POLICY IF EXISTS facility_portal_insert_assigned_service_records ON public.property_service_records;
CREATE POLICY facility_portal_insert_assigned_service_records
  ON public.property_service_records
  FOR INSERT
  TO authenticated
  WITH CHECK (
    tenant_id = public.current_user_facility_manager_tenant_id()
    AND public.facility_manager_has_property(property_id)
    AND logged_by_facility_manager_id = public.current_user_facility_manager_id()
    AND EXISTS (
      SELECT 1
      FROM public.facility_managers fm
      WHERE fm.facility_manager_id = public.current_user_facility_manager_id()
        AND fm.tenant_id = public.current_user_facility_manager_tenant_id()
        AND fm.status = 'active'
        AND fm.can_log_services IS TRUE
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.property_service_records TO authenticated;
GRANT ALL ON TABLE public.property_service_records TO service_role;

DROP POLICY IF EXISTS facility_portal_select_assigned_properties ON public.properties;
CREATE POLICY facility_portal_select_assigned_properties
  ON public.properties
  FOR SELECT
  TO authenticated
  USING (
    tenant_id = public.current_user_facility_manager_tenant_id()
    AND public.facility_manager_has_property(property_id)
  );

DROP POLICY IF EXISTS facility_portal_select_assigned_units ON public.property_units;
CREATE POLICY facility_portal_select_assigned_units
  ON public.property_units
  FOR SELECT
  TO authenticated
  USING (
    tenant_id = public.current_user_facility_manager_tenant_id()
    AND public.facility_manager_has_property(property_id)
  );

DROP POLICY IF EXISTS facility_portal_select_assigned_leases ON public.leases;
CREATE POLICY facility_portal_select_assigned_leases
  ON public.leases
  FOR SELECT
  TO authenticated
  USING (
    tenant_id = public.current_user_facility_manager_tenant_id()
    AND EXISTS (
      SELECT 1
      FROM public.property_units u
      WHERE u.unit_id = leases.unit_id
        AND u.tenant_id = leases.tenant_id
        AND public.facility_manager_has_property(u.property_id)
    )
  );

DROP POLICY IF EXISTS facility_portal_select_assigned_maintenance ON public.maintenance_requests;
CREATE POLICY facility_portal_select_assigned_maintenance
  ON public.maintenance_requests
  FOR SELECT
  TO authenticated
  USING (
    tenant_id = public.current_user_facility_manager_tenant_id()
    AND EXISTS (
      SELECT 1
      FROM public.leases l
      JOIN public.property_units u
        ON u.unit_id = l.unit_id AND u.tenant_id = l.tenant_id
      WHERE l.lease_id = maintenance_requests.lease_id
        AND l.tenant_id = maintenance_requests.tenant_id
        AND public.facility_manager_has_property(u.property_id)
    )
  );

DROP POLICY IF EXISTS facility_portal_select_assigned_complaints ON public.lessee_complaints;
CREATE POLICY facility_portal_select_assigned_complaints
  ON public.lessee_complaints
  FOR SELECT
  TO authenticated
  USING (
    tenant_id = public.current_user_facility_manager_tenant_id()
    AND EXISTS (
      SELECT 1
      FROM public.leases l
      JOIN public.property_units u
        ON u.unit_id = l.unit_id AND u.tenant_id = l.tenant_id
      WHERE l.lease_id = lessee_complaints.lease_id
        AND l.tenant_id = lessee_complaints.tenant_id
        AND public.facility_manager_has_property(u.property_id)
    )
  );

ALTER TABLE public.inspections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS inspections_tenant_select ON public.inspections;
CREATE POLICY inspections_tenant_select
  ON public.inspections
  FOR SELECT
  TO authenticated
  USING (public.tenant_matches(tenant_id));

DROP POLICY IF EXISTS inspections_tenant_insert ON public.inspections;
CREATE POLICY inspections_tenant_insert
  ON public.inspections
  FOR INSERT
  TO authenticated
  WITH CHECK (public.tenant_matches(tenant_id));

DROP POLICY IF EXISTS inspections_tenant_update ON public.inspections;
CREATE POLICY inspections_tenant_update
  ON public.inspections
  FOR UPDATE
  TO authenticated
  USING (public.tenant_matches(tenant_id))
  WITH CHECK (public.tenant_matches(tenant_id));

DROP POLICY IF EXISTS inspections_tenant_delete ON public.inspections;
CREATE POLICY inspections_tenant_delete
  ON public.inspections
  FOR DELETE
  TO authenticated
  USING (public.tenant_matches(tenant_id));

DROP POLICY IF EXISTS facility_portal_select_assigned_inspections ON public.inspections;
CREATE POLICY facility_portal_select_assigned_inspections
  ON public.inspections
  FOR SELECT
  TO authenticated
  USING (
    tenant_id = public.current_user_facility_manager_tenant_id()
    AND EXISTS (
      SELECT 1
      FROM public.leases l
      JOIN public.property_units u
        ON u.unit_id = l.unit_id AND u.tenant_id = l.tenant_id
      WHERE l.lease_id = inspections.lease_id
        AND l.tenant_id = inspections.tenant_id
        AND public.facility_manager_has_property(u.property_id)
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.inspections TO authenticated;
GRANT ALL ON TABLE public.inspections TO service_role;

DROP POLICY IF EXISTS facility_portal_select_assigned_rent_ledger ON public.rent_ledger;
CREATE POLICY facility_portal_select_assigned_rent_ledger
  ON public.rent_ledger
  FOR SELECT
  TO authenticated
  USING (
    tenant_id = public.current_user_facility_manager_tenant_id()
    AND EXISTS (
      SELECT 1
      FROM public.leases l
      JOIN public.property_units u
        ON u.unit_id = l.unit_id AND u.tenant_id = l.tenant_id
      WHERE l.lease_id = rent_ledger.lease_id
        AND l.tenant_id = rent_ledger.tenant_id
        AND public.facility_manager_has_property(u.property_id)
    )
  );

DROP POLICY IF EXISTS facility_portal_select_assigned_lessees ON public.lessees;
CREATE POLICY facility_portal_select_assigned_lessees
  ON public.lessees
  FOR SELECT
  TO authenticated
  USING (
    tenant_id = public.current_user_facility_manager_tenant_id()
    AND EXISTS (
      SELECT 1
      FROM public.leases l
      JOIN public.property_units u
        ON u.unit_id = l.unit_id AND u.tenant_id = l.tenant_id
      WHERE l.lessee_id = lessees.lessee_id
        AND l.tenant_id = lessees.tenant_id
        AND l.status = 'active'
        AND public.facility_manager_has_property(u.property_id)
    )
  );

NOTIFY pgrst, 'reload schema';

COMMIT;
