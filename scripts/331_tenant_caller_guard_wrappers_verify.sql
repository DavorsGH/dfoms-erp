WITH targets(name) AS (
  VALUES
    ('save_client_invoice'),
    ('change_client_invoice_status'),
    ('void_client_invoice'),
    ('checkout_pos_cart'),
    ('void_product_sale'),
    ('record_refund'),
    ('save_accounts_payable'),
    ('delete_accounts_payable'),
    ('recompute_accounts_payable_from_payments'),
    ('record_supplier_contract_replacement_payment'),
    ('save_fixed_asset'),
    ('delete_fixed_asset'),
    ('create_fixed_asset_payable'),
    ('sync_fixed_asset_payable'),
    ('reverse_fixed_asset_payable'),
    ('replace_purchase_tax_ledger_entries'),
    ('generate_next_code'),
    ('submit_leave_request'),
    ('approve_leave_request'),
    ('reject_leave_request'),
    ('cancel_leave_request'),
    ('create_product_return')
)
SELECT
  coalesce(w.proname, t.name) AS function_name,
  pg_get_function_identity_arguments(w.oid) AS signature,
  (i.oid IS NOT NULL) AS impl_exists,
  CASE
    WHEN w.oid IS NULL THEN NULL
    ELSE has_function_privilege('anon', w.oid, 'EXECUTE')
  END AS wrapper_anon,
  CASE
    WHEN w.oid IS NULL THEN NULL
    ELSE has_function_privilege('authenticated', w.oid, 'EXECUTE')
  END AS wrapper_authenticated,
  CASE
    WHEN w.oid IS NULL THEN NULL
    ELSE has_function_privilege('service_role', w.oid, 'EXECUTE')
  END AS wrapper_service_role,
  CASE
    WHEN i.oid IS NULL THEN NULL
    ELSE has_function_privilege('anon', i.oid, 'EXECUTE')
  END AS impl_anon,
  CASE
    WHEN i.oid IS NULL THEN NULL
    ELSE has_function_privilege('authenticated', i.oid, 'EXECUTE')
  END AS impl_authenticated,
  CASE
    WHEN i.oid IS NULL THEN NULL
    ELSE has_function_privilege('service_role', i.oid, 'EXECUTE')
  END AS impl_service_role
FROM targets t
LEFT JOIN pg_proc w
  ON w.proname = t.name
 AND w.prokind = 'f'
LEFT JOIN pg_namespace n
  ON n.oid = w.pronamespace
 AND n.nspname = 'public'
LEFT JOIN pg_proc i
  ON i.pronamespace = n.oid
 AND w.oid IS NOT NULL
 AND i.proname = w.proname || '__impl'
 AND i.proargtypes = w.proargtypes
WHERE w.oid IS NULL OR n.nspname = 'public'
ORDER BY t.name, pg_get_function_identity_arguments(w.oid) NULLS FIRST;
