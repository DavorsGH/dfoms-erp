-- Script 190: Staging-only cleanup — Caanta duplicate expense bulk-import rows
-- (jobs 1+2 of 3 commits on 2026-08-09; keep job 2f912314-8fb1-4d65-b919-02a8616e07db)
--
-- STAGING ONLY. Review verification output before running.
-- Does NOT touch bulk_import_jobs or bulk_import_rows.
--
-- Dry run: replace final COMMIT with ROLLBACK and inspect NOTICE output.
--
-- Verified 2026-08-09 via scripts/verify-caanta-expense-bulk-import-cleanup-staging.ts:
--   tenant: Caanta Market (61e8e5d9-9cdb-4b8d-9e44-ed0acc23d87b)
--   delete: 40 expense_register rows, 36 tax_ledger_entries rows
--   keep:   20 expense_register rows (job 3), internally consistent tax legs

BEGIN;

DO $$
DECLARE
  v_tenant_id uuid := '61e8e5d9-9cdb-4b8d-9e44-ed0acc23d87b';
  v_delete_ids uuid[] := ARRAY[
    -- Job d83bf87a-3cd7-4d0b-bb2d-0a9779adeaef (1st commit, 2026-08-09 14:43:20 UTC)
    '3a7cc3a9-abbb-4efd-b68e-b5d4fe417a61'::uuid,
    '55179292-6d4a-4e32-b4d9-8e2d11ced788'::uuid,
    '417340cd-732a-42cb-a531-759e17e71765'::uuid,
    '5e689a9f-7ada-4e1e-a980-941330932334'::uuid,
    '230c28f1-5271-415a-b157-d8b6e7c3ccd7'::uuid,
    '70c6e0a7-72c9-4fc8-9b22-247e408deda7'::uuid,
    '6d0b80fa-9c8a-41d8-9fbf-b5140d1c7805'::uuid,
    '2c8e6f58-c83f-4b1f-94e3-c12077373cdd'::uuid,
    '8454dbd6-9e40-4d04-87f1-75db7958c726'::uuid,
    '1f5690a7-25a5-4ef7-827c-a388fcff50e8'::uuid,
    '8b22024f-8046-4397-86ae-68876641b95d'::uuid,
    '14d3e607-cb69-4d95-ac19-00408afa2465'::uuid,
    '0a114d9c-e2d3-4052-a910-ec9fde0acaa2'::uuid,
    '2b8b40c5-b35c-4f2e-a9c3-3e4d3c4ffba1'::uuid,
    '0fbff809-e8cb-4602-9032-4103ae9c3a11'::uuid,
    '0808abe9-a80a-4c95-a8e8-327c52391cea'::uuid,
    '17614909-1891-439e-8569-b4300c9ea3ee'::uuid,
    '0602f407-fe1e-4e78-9d04-fda02d4ee237'::uuid,
    '077da87a-2a90-4fbc-be10-e5351a96a451'::uuid,
    '9ff3349b-4f82-4c6d-bd56-d8512ec82c89'::uuid,
    -- Job 75ad77c8-06b1-4bf9-84e2-d1b7f8c275bd (2nd commit, 2026-08-09 14:46:06 UTC)
    '532b0c31-dd2e-44b5-9aed-a7a80b6cb577'::uuid,
    '64d6583c-42be-4683-b587-bf4c75c6a834'::uuid,
    '50b7d826-808d-4aba-add8-125a68a73670'::uuid,
    '6f6d5759-7b7d-43de-9584-bfe7e9fe2956'::uuid,
    '3c62cf72-1cc9-4e82-b7d8-7b8c21daaa27'::uuid,
    '8acaa8f3-4d2e-435e-a0d4-35724b3a84b2'::uuid,
    '742e261c-4df0-446a-9ade-4f45dbc9de82'::uuid,
    'a4d9515e-81cc-4e65-bbda-dbcdb813e4e8'::uuid,
    'cdd8037c-dc30-4307-b9cd-7f0a3de16ab4'::uuid,
    '704e19bd-792b-4619-ba7f-1d40974c4ca9'::uuid,
    'c4be578f-d1c7-4aa8-b9e9-1e08222a1af5'::uuid,
    'd8351c4f-b531-4db7-86bc-5da57966211c'::uuid,
    '43ff3c5e-70db-4114-9b42-61b744214ec1'::uuid,
    '5387aa89-8a05-413b-90b5-a205a6dbee99'::uuid,
    '79cf23f3-e9d2-4fea-92dc-4b184fed32fa'::uuid,
    '8a7400fc-b598-4ba0-a348-1c9488a762b2'::uuid,
    '800e3dcd-08a6-4cfa-a0c7-e62ea4198f13'::uuid,
    '067f106d-4ed1-4379-a33b-5f287bc10c8c'::uuid,
    '240d4a2e-c07a-4781-bbd1-8579f28b68d0'::uuid,
    'bdbf2fc6-b53b-4486-832b-f5cc0ec7c542'::uuid
  ];
  v_keep_ids uuid[] := ARRAY[
    -- Job 2f912314-8fb1-4d65-b919-02a8616e07db (3rd commit — KEEP)
    '6cdf890d-43ec-4082-a156-7dfd492546e0'::uuid,
    '7602b73c-083a-4330-af08-46507fcac474'::uuid,
    '84a3d1c8-8079-49b7-bd40-42750d6c46d2'::uuid,
    'fac80173-6536-4d72-b414-64d6280677ea'::uuid,
    'd0400de4-2620-4f6c-92df-2e050da16d5e'::uuid,
    'afe74835-d28a-4566-b5de-07fe58affdf0'::uuid,
    'b43825a8-1915-4ffc-b7d5-2d1587f18cac'::uuid,
    'feb5fd66-6be5-4e09-8411-f2722012948c'::uuid,
    'ddd73c8c-6d03-4ba1-8a42-2f205e8db01a'::uuid,
    'ba61d73c-9659-4644-870c-73ca7db7cfd0'::uuid,
    'e10acd97-ad8e-4be4-a96a-5564d6d5c989'::uuid,
    'efb38368-d3b0-403b-9951-39634552dfce'::uuid,
    'ddb64b6f-a4ee-4ad0-85a6-02cbc5e93979'::uuid,
    'fee65cd1-364b-4f3b-b93f-51866fbac359'::uuid,
    '7a192380-515d-46c1-9bfc-0a9678ab2662'::uuid,
    'b867c426-7a9a-47c3-b889-c5543c90bc36'::uuid,
    'c31946a6-3fb1-431f-b191-73f65138cefa'::uuid,
    'd82ed0e2-cd75-436b-8ce4-b09c85ebb561'::uuid,
    'bfe3b830-c17c-4d53-a32d-31d39a1071d1'::uuid,
    'f6638053-55fa-493a-867b-2150add32fae'::uuid
  ];
  v_expense_before integer;
  v_expense_delete_target integer;
  v_expense_keep_target integer;
  v_ledger_delete_target integer;
  v_overlap_delete_keep integer;
  v_wrong_tenant integer;
  v_expense_deleted integer;
  v_ledger_deleted integer;
  v_expense_after integer;
BEGIN
  IF current_database() ILIKE '%prod%' THEN
    RAISE EXCEPTION 'Refusing to run: database name looks like production (%)', current_database();
  END IF;

  SELECT count(*) INTO v_expense_before
  FROM public.expense_register
  WHERE tenant_id = v_tenant_id;

  SELECT count(*) INTO v_expense_delete_target
  FROM public.expense_register
  WHERE tenant_id = v_tenant_id
    AND id = ANY(v_delete_ids);

  SELECT count(*) INTO v_expense_keep_target
  FROM public.expense_register
  WHERE tenant_id = v_tenant_id
    AND id = ANY(v_keep_ids);

  SELECT count(*) INTO v_ledger_delete_target
  FROM public.tax_ledger_entries
  WHERE tenant_id = v_tenant_id
    AND source_type = 'expense_register'
    AND source_id = ANY(v_delete_ids);

  SELECT count(*) INTO v_overlap_delete_keep
  FROM unnest(v_delete_ids) AS d(id)
  JOIN unnest(v_keep_ids) AS k(id) ON d.id = k.id;

  SELECT count(*) INTO v_wrong_tenant
  FROM public.expense_register
  WHERE id = ANY(v_delete_ids)
    AND tenant_id <> v_tenant_id;

  RAISE NOTICE 'Caanta expense_register before: %', v_expense_before;
  RAISE NOTICE 'Delete targets (expense_register): % (expect 40)', v_expense_delete_target;
  RAISE NOTICE 'Keep targets (expense_register): % (expect 20)', v_expense_keep_target;
  RAISE NOTICE 'Delete targets (tax_ledger_entries): % (expect 36)', v_ledger_delete_target;
  RAISE NOTICE 'Delete/keep overlap: % (expect 0)', v_overlap_delete_keep;
  RAISE NOTICE 'Wrong-tenant delete IDs: % (expect 0)', v_wrong_tenant;

  IF array_length(v_delete_ids, 1) <> 40 THEN
    RAISE EXCEPTION 'Delete ID array length is %, expected 40', array_length(v_delete_ids, 1);
  END IF;

  IF array_length(v_keep_ids, 1) <> 20 THEN
    RAISE EXCEPTION 'Keep ID array length is %, expected 20', array_length(v_keep_ids, 1);
  END IF;

  IF v_expense_delete_target <> 40 THEN
    RAISE EXCEPTION 'Expected 40 delete-target expense rows, found %', v_expense_delete_target;
  END IF;

  IF v_expense_keep_target <> 20 THEN
    RAISE EXCEPTION 'Expected 20 keep-target expense rows, found %', v_expense_keep_target;
  END IF;

  IF v_overlap_delete_keep <> 0 OR v_wrong_tenant <> 0 THEN
    RAISE EXCEPTION 'Safety check failed (overlap=% wrong_tenant=%)', v_overlap_delete_keep, v_wrong_tenant;
  END IF;

  DELETE FROM public.tax_ledger_entries
  WHERE tenant_id = v_tenant_id
    AND source_type = 'expense_register'
    AND source_id = ANY(v_delete_ids);
  GET DIAGNOSTICS v_ledger_deleted = ROW_COUNT;

  DELETE FROM public.expense_register
  WHERE tenant_id = v_tenant_id
    AND id = ANY(v_delete_ids);
  GET DIAGNOSTICS v_expense_deleted = ROW_COUNT;

  SELECT count(*) INTO v_expense_after
  FROM public.expense_register
  WHERE tenant_id = v_tenant_id;

  RAISE NOTICE 'Deleted tax_ledger_entries: %', v_ledger_deleted;
  RAISE NOTICE 'Deleted expense_register: %', v_expense_deleted;
  RAISE NOTICE 'Caanta expense_register after: % (expect %)', v_expense_after, v_expense_before - 40;

  IF v_expense_deleted <> 40 THEN
    RAISE EXCEPTION 'Deleted % expense rows, expected 40', v_expense_deleted;
  END IF;

  IF v_expense_after <> v_expense_before - 40 THEN
    RAISE EXCEPTION 'Post-delete expense count % != expected %', v_expense_after, v_expense_before - 40;
  END IF;
END $$;

COMMIT;
-- ROLLBACK;  -- uncomment for dry run instead of COMMIT

NOTIFY pgrst, 'reload schema';
