# Staging-only scripts

**Not part of the numbered production migration sequence.**  
Hardcoded staging tenant IDs — never run against production.

## Apply migrations (Release 1 Part 2)

```bash
npx tsx scripts/staging-only/apply-PART2-salary-advance-maternity-staging.ts
npx tsx scripts/staging-only/apply-374-maternity-delta-staging.ts
npx tsx scripts/staging-only/apply-365-stock-adjustment-rls-staging.ts
```

## Reusable verification (authenticated users where noted)

| Script | Purpose |
|--------|---------|
| `test-release1-mutations-as-user.ts` | Step 42 RLS + inventory mutations matrix (19 checks) |
| `prove-caanta-advance-bs-as-user.ts` | Salary advance → BS / cash flow / lock-reopen (Caanta) |
| `prove-payroll-relock-postings.ts` | Reopen + re-lock payroll posting fingerprint compare |
| `prove-maternity-caanta-as-user.ts` | Maternity policy, overlap, approve, separate balance |
| `delete-ic-entry-and-verify-direct-op.ts` | IC delete via API + Facilities Direct Operational check |
| `reverse-r1-test-data-staging.ts` | Reverse R1 test inventory/advances (triggers/RPCs, not raw orphan income) |
| `delete-staging-test-users.ts` | Remove `@test.davors` auth + user_accounts |
| `prove-r1-http-ic-batch-as-user.ts` | IC + production batch PATCH/DELETE via session API |
| `step44-davors-readonly-forensics.ts` | Read-only Oct–Dec BS + suspicious Davors rows |
| `prove-payroll-dedsav-caanta-staging.ts` | Caanta DEDSAV reopen/re-lock + register advance exclusion |
| `delete-davors-fp-test-adjustment-staging.ts` | Remove stray FP `reason=test` via normal DELETE |
| `audit-r1-test-artifacts-staging.ts` | List remaining R1 test rows on staging |
| `PART2-salary-advance-maternity-test-steps.md` | Manual UI checklist |

Test scripts that create users must call `delete-staging-test-users.ts` (or self-delete) after a run.

## Davors data fixes (SQL / one-off tenant repairs)

| Script | Purpose |
|--------|---------|
| `apply-davors-staging-data-fixes.ts` | Bundled Davors staging repairs |
| `davors-*.sql` | Targeted SQL fixes (loans, SKU, etc.) |
| `audit-davors-technologies-cross-tenant-staging.ts` | Cross-tenant audit |

Requires `APP_URL` (default `http://localhost:3000`) and a running dev server for API-route proofs.
