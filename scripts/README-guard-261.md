# Guard 261 — deployed onConflict safety

Refuse applying `261_phase5e_key_structure_bu_uniques.sql` until the **Ready**
deployment matches Phase 5e app `onConflict` targets.

## Client-scanned tables (automated)

| Table | Required positive signal in `/_next/static` JS |
|-------|-----------------------------------------------|
| `tax_settings` | `tenant_id,business_unit_id` |
| `manual_financial_entries` | `tenant_id,business_unit_id,period_month` |

The guard authenticates with an ephemeral staff user (when env keys are present)
so dashboard route chunks are reachable. Login-shell-only scans are inconclusive.

## `month_end_close` — UNVERIFIED via chunk scan

Lock / Reopen / Release live in **server-only** API routes:

- `app/api/hr-payroll/lock-period/route.ts`
- `app/api/hr-payroll/release-period/route.ts`
- `app/api/hr-payroll/reopen-period/route.ts`

Those strings **never** appear in browser-downloadable chunks. The guard therefore:

- Does **not** treat absence of `tenant_id,business_unit_id,month` as PASS
- Does **not** treat that absence as FAIL for the table itself
- Prints an explicit **UNVERIFIED** message
- Requires `--confirm-month-end-close-server` for overall auto-apply PASS

### Before you pass `--confirm-month-end-close-server`

This is **not** a rubber stamp. On the **exact deploy commit SHA** (same as the
Ready Vercel deployment), open all three routes and confirm each
`month_end_close` upsert uses onConflict resolving to exactly:

```text
tenant_id,business_unit_id,month
```

Typically via `MONTH_END_CLOSE_ON_CONFLICT` from `utils/phase5e-key-structure.ts`.
Reject confirmation if any route still uses `tenant_id,month` or omits
`business_unit_id`.

## Commands

```bash
# Client scan only (will REFUSE without month_end confirm — expected)
npx tsx scripts/guard-261-deployed-onconflict.ts --env staging

# After human attestation of the three API routes on the deploy SHA
npx tsx scripts/guard-261-deployed-onconflict.ts --env staging --confirm-month-end-close-server

# Apply schema (same confirm flag required unless --skip-guard)
npx tsx scripts/apply-261-phase5e-key-structure-bu-uniques.ts --env staging --confirm-month-end-close-server
```
