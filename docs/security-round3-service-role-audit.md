# Security Round 3 — Service-Role Call-Site Audit

**Date:** 3 October 2026  
**Scope:** Application code under `app/`, `lib/`, `utils/`, `components/`, `hooks/`, middleware, API routes, server actions, and cron/webhook routes. **Excluded:** `scripts/`, tests.  
**Baseline:** `docs/phase1-query-audit.md` (July 2026) — this report covers **all current** service-role and direct-Postgres usage since that audit.

**Service-role entry points**

| Mechanism | Location |
|-----------|----------|
| `createAdminClient()` | `utils/supabase/admin.ts` — `SUPABASE_SERVICE_ROLE_KEY` |
| `createServiceRoleClient()` | `utils/user-activity-log-write.ts` — same key, inline client |
| `createMfaServiceClient()` | `lib/mfa/aal-gate.ts` — same key when no caller client passed |
| Direct Postgres | `pg.Client` + `resolveDatabaseUrl()` / `DATABASE_URL` in `app/api/bulk-import/.../commit`, `lib/bulk-import/*`, `utils/business-units-server.ts`, `utils/admin-user-business-unit-access.ts` |

**Middleware:** `utils/supabase/middleware.ts` — **no** service-role usage (publishable key only).

**Inventory size (approx.):** ~177 files under `app/`, ~57 under `utils/`, ~14 under `lib/` reference `createAdminClient` or inline service role; **0** under `components/` or `hooks/`.

---

## Executive summary

Most tenant-scoped API routes follow a sound pattern: authenticate with the user’s session, derive `tenantId` from `requireTenantRoleIn` / `requireTenantSuperAdmin` (session + `user_accounts`), reject client-supplied `tenant_id` where enforced, then use the service role only for operations that need Auth Admin, storage signed URLs, or SECURITY DEFINER RPCs — with explicit `.eq("tenant_id", auth.tenantId)` or RPC `p_tenant_id` on writes.

Cross-tenant **platform** flows (Davors real-estate staff, platform super-admin, crons, webhooks) intentionally use service role; gates are role-based or secret-based rather than single-tenant RLS.

**Highest gaps:** unauthenticated endpoints that still touch service role (`/api/heartbeat`, public Paystack callback page), and a few read paths where IDs from the URL/body are not re-bound to the caller’s tenant before admin queries.

---

## NEEDS FIX (severity order)

### 1. Critical / high — unauthenticated payment-request access (public page)

| Field | Detail |
|-------|--------|
| **File** | `app/pay/product-sale/callback/page.tsx` — `ProductSalePaymentCallbackPage` |
| **Trigger** | **(d)** Public — customer browser return from Paystack (no login) |
| **Tables** | `product_sale_payment_requests` (read); fulfillment writes via `utils/pos-momo-fulfillment.ts` (`product_sale_payment_requests`, POS/income RPC paths) |
| **Gap** | When `payment_request_id` is supplied without `reference`, the page loads the row by **UUID only** (no tenant, no session). Any guessable/leaked UUID exposes `invoice_no`, `status`, `paystack_reference`, `authorization_url`. Fulfillment still requires Paystack `verifyPaystackTransaction` success on that row’s reference, but **information disclosure** and **oracle behavior** (confirm whether an ID exists / is paid) are cross-tenant. |
| **Exploit** | Attacker iterates or obtains UUIDs from SMS/links/logs and queries the public callback URL to read another tenant’s payment state or harvest references. |
| **Fix direction** | Require signed `reference` (or HMAC token binding `payment_request_id` + tenant) on the callback; or move fulfillment to webhook + authenticated POS confirm only (`app/api/sales/paystack/momo/confirm/route.ts` already checks `requestRow.tenant_id !== auth.tenantId`). |

### 2. Medium — unauthenticated health check uses service role without tenant scope

| Field | Detail |
|-------|--------|
| **File** | `app/api/heartbeat/route.ts` — `GET` |
| **Trigger** | **(d)** Public — monitoring/uptime (no auth) |
| **Tables** | `employees` (select `employee_id`, limit 1) |
| **Gap** | Service role bypasses RLS; query is **not** filtered by tenant. Confirms DB connectivity but reads arbitrary tenant data (minimal columns, still cross-tenant). Error messages may leak schema/DB state. |
| **Exploit** | Anyone hits `/api/heartbeat` to probe production DB availability and infer row existence; expands blast radius if endpoint is abused for timing/enumeration. |
| **Fix direction** | Use a tenant-agnostic check (`select 1` via RPC, or Supabase health) with **user/anon** client, or protect endpoint (Vercel cron only, IP allowlist, shared secret). |

### 3. Medium — open redirect via short links (service-role read on public route)

| Field | Detail |
|-------|--------|
| **Files** | `app/s/[code]/route.ts` — `GET`; `utils/short-links.ts` — `lookupShortLinkDestination`, `resolveDestinationRedirectUrl`, `createShortLinkUrl` |
| **Trigger** | **(d)** Public redirect; **(a)** link creation from authenticated flows (`app/api/sales/paystack/initialize/route.ts`, `utils/real-estate-staff-notifications.ts`) |
| **Tables** | `short_links` (insert/select) |
| **Gap** | `resolveDestinationRedirectUrl` allows **any absolute `https://` URL** stored in `destination_url`. Public GET uses admin client to resolve code → 302. Compromised insert path or DB row tampering → phishing redirect. Not classic cross-tenant data read, but service role enables **unauthenticated redirect** to attacker URL. |
| **Exploit** | If an attacker can write `short_links` (SQL injection elsewhere, leaked service key, or malicious `destination` passed into `createShortLinkUrl`), victims receive trusted-domain short links that redirect off-site. |
| **Fix direction** | Allowlist destinations (same-site paths or Paystack hosts only); store tenant_id on rows; validate on insert. |

### 4. Low / medium — handbook screenshot signed URLs (any authenticated persona)

| Field | Detail |
|-------|--------|
| **File** | `app/api/storage/handbook-screenshots/signed-url/route.ts` — `GET` |
| **Trigger** | **(a)** Any logged-in user (staff dashboard, lessee portal, landlord portal) |
| **Tables** | Storage bucket `handbook-screenshots` (via admin storage API) |
| **Gap** | Auth only checks “some session exists”. `reference` query param is parsed to a path under the bucket without per-tenant binding. Today bucket is platform handbook assets; if non-public objects are added, **any authenticated user** could request signed URLs for arbitrary paths in that bucket. |
| **Exploit** | Malicious tenant user passes crafted `reference` encoding another object path → temporary signed URL. |
| **Fix direction** | Restrict to known path prefix list, or require platform role for non-public objects. |

### 5. Low — defense in depth: `requireTenantRoleIn` tenant binding via RLS client

| Field | Detail |
|-------|--------|
| **File** | `utils/admin-auth.ts` — `requireTenantRoleIn` |
| **Trigger** | **(a)** Most finance/operations API routes |
| **Gap** | `tenantId` comes from `user_accounts` read through the **user’s** Supabase client (RLS), unlike `requireTenantSuperAdmin` which uses service role for the same lookup. If RLS on `user_accounts` were misconfigured, a caller could obtain a wrong `tenantId` while subsequent admin writes use that value. |
| **Exploit** | Hypothetical RLS regression → cross-tenant writes on routes that trust `auth.tenantId` without re-checking row ownership on every admin query. |
| **Fix direction** | Align with `requireTenantSuperAdmin`: load `tenant_id` via service role keyed by session `auth_uid`, or always verify row IDs with `assertServerRowWriteAccess` (already done on sensitive finance routes). |

---

## UNNECESSARY SERVICE ROLE (could use user client + RLS)

These are not immediate vulnerabilities but increase bypass surface. Prefer session client when RLS already enforces tenant scope.

| Location | Why SR is likely unnecessary |
|----------|------------------------------|
| `utils/dashboard-shell-data.ts` — `loadBusinessUnitSwitcherOptions` | Read `business_units` filtered by `tenantId` from session; user client + RLS sufficient. |
| `app/api/support-tickets/route.ts` | Insert already via user client; admin only loads `tenants.name` for one `auth.tenantId`. |
| Many dashboard **read-only** pages that call `createAdminClient()` then `.eq("tenant_id", sessionTenant)` | e.g. list loaders where Supabase RLS policies already match tenant — SR duplicates RLS with extra risk if filter is forgotten. |
| `utils/assistant-handbook-retrieval.ts` | Handbook chunks are platform-global; could use anon/authenticated policy on `handbook_*` tables instead of SR. |
| `app/api/heartbeat/route.ts` | Should not use SR at all (see NEEDS FIX). |

**Keep service role (justified):** Auth Admin (`auth.admin.*`), storage signed URLs, SECURITY DEFINER RPCs (`void_client_invoice_payment`, `save_accounts_payable`, payroll/tax atomic RPCs), cross-table provisioning (signup, invites), platform billing crons, Paystack webhook fulfillment, notification fan-out that must bypass RLS, MFA settings when session cannot read own row.

---

## Cron routes (b) — secret before work, per-tenant processing

All under `app/api/cron/*/route.ts`. Pattern: `authorizeCronRequest` compares `Authorization: Bearer ${CRON_SECRET}` **before** calling utils; returns 401 if secret missing/wrong.

| Route | Admin / SR | Core util | Tenant isolation |
|-------|------------|-----------|------------------|
| `balance-sheet-integrity/route.ts` | Creates admin in route | `utils/tenant-balance-sheet-integrity-status.ts` | Iterates tenants; per-tenant checks |
| `generate-rent-ledger/route.ts` | Creates admin in route | `utils/generate-rent-ledger.ts` | Per landlord tenant in job loop |
| `generate-service-contract-invoices/route.ts` | Via util default | `utils/generate-service-contract-invoices.ts` | Optional `tenantId` query; loops with filter |
| `generate-supplier-contract-ap/route.ts` | Via util | `utils/generate-supplier-contract-accounts-payable.ts` | Optional `tenantId`; contract query filtered |
| `statutory-reminders/route.ts` | Via util | `utils/statutory-reminders.ts` | Per tenant (+ BU); dry-run `tenantId` param requires secret |
| `rent-due-reminders/route.ts` | Via util | `utils/rent-due-reminders.ts` | Per tenant |
| `product-sale-due-reminders/route.ts` | Via util | `utils/product-sale-due-reminders.ts` | Per tenant |
| `paystack-reconciliation/route.ts` | Via util | `utils/paystack-reconciliation.ts` | Ledger keyed by reference metadata |
| `platform-unit-billing/route.ts` | Via util | `utils/platform-only-unit-monthly-billing.ts` | Platform tenants only |
| `platform-unit-annual-billing/route.ts` | Via util | `utils/platform-only-unit-annual-billing.ts` | Platform tenants only |
| `platform-unit-trial-reminders/route.ts` | Via util | `utils/platform-only-unit-trial-reminders.ts` | Platform tenants only |
| `mfa-sms-resend-policy-check/route.ts` | (check util) | MFA policy | Global policy rows |
| `formula-dc-sms-status/route.ts`, `formula-dc-sms-test/route.ts` | Provider ops | SMS | N/A |

**Note:** Cron secret holder can pass optional `tenantId` on several routes — acceptable for ops; not callable by end users without secret.

---

## Webhooks (c)

| Route | Verification | Admin usage | Tenant isolation |
|-------|--------------|-------------|------------------|
| `app/api/webhooks/paystack/route.ts` | `verifyPaystackWebhookSignature` **before** parse/process | `utils/paystack-webhook.ts` (many handlers) | Metadata / reference resolves payment context; product-sale path checks metadata tenant vs row |
| `app/api/webhooks/resend/route.ts` | `verifyResendWebhookSignature` | `insertEmailDeliveryEvent`, tenant resolve by message id | Per-message tenant lookup |

---

## Public / unauthenticated (d) — detailed call sites

| File | Function / entry | Tables / storage | Tenant binding | Classification |
|------|------------------|------------------|----------------|----------------|
| `app/api/signup/route.ts` | `POST` | tenants, user_accounts, auth users, provisioning RPCs | New tenant created server-side; email validated | **SAFE** (provisioning must bypass RLS) |
| `app/api/apply/[token]/route.ts`, `upload-id` | token routes | rental applications, storage | Token maps to landlord tenant | **SAFE** if token secret strength OK |
| `app/api/portal/accept-invite/route.ts`, `staff/accept-invite`, `landlord-portal/accept-invite`, `facility-portal/accept-invite` | invite acceptance | invites, auth, portal tables | Token-scoped | **SAFE** |
| `app/api/unsubscribe/[token]/route.ts`, `app/unsubscribe/[token]/page.tsx` | `POST` / page | `customer_comm_preferences`, `tenants` | `unsubscribe_token` unique | **SAFE** |
| `app/auth/callback/route.ts` | OAuth callback | auth, portal dispatch via `dispatchOAuthCallback` | Email + flow cookie | **SAFE** |
| `app/api/landlord-portal/signup/route.ts`, `confirm-email` | signup / verify | landlords, tenants | Email verification | **SAFE** |
| `app/api/heartbeat/route.ts` | `GET` | `employees` | **None** | **NEEDS FIX** (#2) |
| `app/pay/product-sale/callback/page.tsx` | page SSR | payment requests + fulfillment | **Weak** | **NEEDS FIX** (#1) |
| `app/s/[code]/route.ts` | `GET` | `short_links` | N/A (redirect) | **NEEDS FIX** (#3) open redirect |
| `lib/auth/reset-password-redirect-action.ts` | server action | auth lookup | Reset flow | **SAFE** |
| Portal login actions (`app/portal/login/actions.ts`, landlord/facility login) | sign-in | auth, activity log via SR | Persona-specific | **SAFE** |

User-triggered **Paystack confirm** routes (portal rent, POS momo, billing SMS, etc.) use session + Paystack verify + tenant checks on rows — **SAFE** (see `app/api/portal/rent/paystack/confirm/route.ts`, `app/api/sales/paystack/momo/confirm/route.ts`).

---

## User-triggered (a) — patterns and representative call sites

### A. Tenant staff / finance / HR (session `tenantId` from role gate)

**Auth helpers:** `requireTenantRoleIn`, `requireTenantSuperAdmin`, `requireLinkedEmployeeAccount`, `getCurrentUserTenantId`, `assertServerRowWriteAccess`.

| Area | Example files | Admin use | Tenant / role |
|------|---------------|-----------|---------------|
| Supplier contracts | `app/api/supplier-contracts/route.ts`, `[id]/route.ts`, catch-up in POST | Catch-up AP generation RPC | `auth.tenantId`; GET uses user client + RLS |
| Finance RPC | `app/api/finance/tax-ledger/remit/route.ts`, `undo-remit/route.ts` | Atomic remit RPC | `auth.tenantId` + BU scope |
| Client invoices | `app/api/client-invoices/[id]/payments/route.ts`, void payment | `void_client_invoice_payment` | Row access assert + `p_tenant_id` |
| HR payroll | `app/api/hr-payroll/*-period/route.ts` | lock/reopen/release/repair RPCs | Tenant from role gate |
| Operations | `app/api/operations/start-rotation/route.ts`, `approve-roster-rotation/route.ts` | roster tables | Tenant-scoped writes |
| Business units | `app/api/business-units/route.ts` | SR for pointer clears / primary BU logic | `requireTenantSuperAdmin`; rejects body `tenant_id` |
| BU switcher | `app/api/account/active-business-unit/route.ts` | SR updates `user_accounts` | Session auth uid + role; rejects body `tenant_id` |
| Bulk import commit | `app/api/bulk-import/[job_id]/commit/route.ts` | **Postgres transaction** via `lib/bulk-import/commit-import-job.ts` | Job loaded with `.eq("tenant_id", gateAuth.tenantId)` |
| Assistant | `app/api/assistant/chat/route.ts` | Tools in `utils/assistant-*.ts` | Persona + staff role; tools use session tenant |
| Storage | `app/api/storage/tenant-logos/signed-url/route.ts` | Signed URL | Object path tenant must match session |
| Push | `app/api/push/subscribe/route.ts`, `unsubscribe` | `push_subscriptions` | `resolvePushSubscriptionContext` → tenant |
| Service/supplier uploads | `upload-document` routes | Storage + metadata | Tenant role gates |

**Classification:** **SAFE** where `auth.tenantId` or verified row access precedes admin calls (dominant pattern). Re-audit any new route that copies `body.tenant_id` without `assertRealEstateLandlordTenant` / `validateAdminCustomerTenantId`.

### B. Davors platform real-estate staff (`requireDavorsPlatformRealEstateStaff` + `body.tenant_id` = landlord customer tenant)

~40 routes under `app/api/admin/*` (properties, leases, lessees, rent ledger, maintenance, etc.) and dashboard pages under `app/dashboard/real-estate/**`.

| Pattern | Detail |
|---------|--------|
| **Gate** | `app/dashboard/real-estate/layout.tsx` → `isDavorsPlatformRealEstateStaff()`; APIs → `requireDavorsPlatformRealEstateStaff()` |
| **Target tenant** | `tenant_id` in body or `[tenantId]` URL segment = **landlord workspace id** (not caller’s Davors tenant) |
| **Validation** | `assertRealEstateLandlordTenant` / `assertDavorsManagedLandlord` before reads/writes |
| **Tables** | `properties`, `property_units`, `leases`, `lessees`, `rent_ledger`, `maintenance_requests`, `complaints`, `expenses`, storage buckets, etc. |

**Classification:** **SAFE** for intended cross-tenant platform operators. **Exploit** only if a non–real-estate staff user could call `/api/admin/*` — blocked by role gate.

### C. Davors platform super-admin (`requireDavorsPlatformSuperAdmin`)

| File | Tables | Notes |
|------|--------|-------|
| `app/api/admin/tenants/*` | `tenants`, billing | `validateAdminCustomerTenantId` |
| `app/api/admin/platform-billing/update-pricing/route.ts` | platform pricing | Platform-only |
| `app/api/admin/hubtel-balance-log/route.ts` | hubtel balance log | Platform-only |
| `app/api/admin/support-tickets/update/route.ts` | `support_tickets` | Cross-tenant by design |
| `app/dashboard/administration/*` pages | tenants, billing, activity log, system events | Gated in page |

**Classification:** **SAFE** with platform role gate.

### D. Portal personas (lessee / landlord / facility)

| Module | Key files | SR use | Tenant binding |
|--------|-----------|--------|----------------|
| Lessee | `utils/lessee-portal-auth.ts`, `app/api/portal/*`, portal pages | Session resolution, maintenance, rent Paystack | `session.tenantId`, `lesseeId` |
| Landlord | `utils/landlord-portal-auth.ts`, `app/api/landlord-portal/*`, LP pages | Workspace, billing, rent ledger | `session.tenantId` |
| Facility | `utils/facility-portal-auth.ts`, FP pages | Complaints, maintenance | FM session scoped to landlord tenant |

**Classification:** **SAFE** when mutations include session tenant (review new portal routes for missing `.eq("tenant_id", session.tenantId)`).

---

## Direct Postgres (`DATABASE_URL`) — application call sites

| File | Function | Trigger | Tenant scoping |
|------|----------|---------|----------------|
| `app/api/bulk-import/[job_id]/commit/route.ts` | `POST` | (a) Bulk import commit | Job + rows verified via user client with `tenant_id`; PG transaction in `lib/bulk-import/commit-import-job.ts` sets tenant in writes |
| `lib/bulk-import/commit-import-job.ts` | `commitImportJobInTransaction` | Called from commit route | Receives `tenantId` from verified job |
| `lib/bulk-import/resolve-*-for-commit.ts` (5 files) | lookup helpers | Import commit | Scoped by commit context |
| `utils/business-units-server.ts` | deactivate / primary BU | (a) via `business-units` API | `tenantId` parameter from auth |
| `utils/admin-user-business-unit-access.ts` | BU access replace | (a) `app/api/admin/users/business-unit-access/route.ts` | `tenantId` + `auth_uid` from gate |

**Classification:** **SAFE** if commit route pre-checks remain; PG bypasses RLS — **must not** expose commit to wrong job id (currently guarded).

---

## Shared utils invoked from multiple triggers

| Util | Triggers | Tables (typical) | Notes |
|------|----------|------------------|-------|
| `utils/paystack-webhook.ts` | (c) webhook | payments, rent, subscriptions, product sales | Signature verified in route |
| `utils/paystack-product-sale-webhook.ts` | (c) | product sale requests | Tenant metadata check |
| `utils/generate-rent-ledger.ts` | (b) cron, (a) admin generate | rent_ledger | Per tenant |
| `utils/generate-service-contract-invoices.ts` | (b) cron | service contracts, invoices | Per tenant |
| `utils/generate-supplier-contract-accounts-payable.ts` | (b) cron, (a) create catch-up | supplier_contracts, AP RPC | Per contract `tenant_id` |
| `utils/statutory-reminders.ts` | (b) cron | tax_settings, reminders log | Per tenant/BU |
| `utils/user-activity-log-write.ts` | (a)(d) auth events | `user_activity_log` | Insert-only; tenant from resolver |
| `utils/security-notifications.ts`, `utils/tenant-admin-director-notifications.ts` | (a)(b) | notifications | Fan-out per `tenantId` arg |
| `utils/real-estate-document-notifications.ts`, `utils/client-document-notifications.ts` | (a) | email/SMS | Scoped by contract/invoice tenant |
| `lib/system-event-log.ts` | (b)(c) | system events | Platform audit |
| `lib/mfa/*.ts` | (a) enrollment/login | `user_mfa_settings`, SMS OTP | By `auth_uid` |
| `utils/trial-enforcement.ts`, `utils/phase5e-lock.ts` | (a) dashboard | tenants, locks | Session tenant |
| `utils/admin-auth.ts` | (a) | `user_accounts` | SR for super-admin tenant lookup |

---

## lib/ — service-role call sites

| File | Purpose | Trigger | Classification |
|------|---------|---------|----------------|
| `lib/auth/portal-metadata.ts` | Sync auth app_metadata | (a) user admin routes | **SAFE** — auth uid bound |
| `lib/auth/reset-password-redirect-action.ts` | Password reset | (d) | **SAFE** |
| `lib/mfa/persist-settings.ts`, `sms-otp.ts`, `sms-phone.ts`, `enrollment-actions.ts` | MFA | (a)(d) | **SAFE** — auth uid |
| `lib/security/password-updated-at.ts` | Password timestamp | (a) signup/update | **SAFE** |
| `lib/system-event-log.ts` | Platform event log | (b)(c) | **SAFE** |
| `lib/bulk-import/*` | PG commit + resolves | (a) | **SAFE** with job checks |

---

## Complete file inventory (service role)

### `app/` (177 files)

<details>
<summary>API routes (click to expand)</summary>

- `app/api/account/active-business-unit/route.ts`
- `app/api/admin/complaints/create|update/route.ts`
- `app/api/admin/deposits/resolve/route.ts`
- `app/api/admin/expenses/create|update|delete|upload-receipt/route.ts`
- `app/api/admin/hubtel-balance-log/route.ts`
- `app/api/admin/inspections/create|update|upload-photo/route.ts`
- `app/api/admin/landlords/approve|create|reject|suspend|update|convert-to-davors-managed/route.ts`
- `app/api/admin/leases/*` (create, update, terminate, signature, rent-change, charge-settings, upload-document, upload-move-in-photo, termination-request)
- `app/api/admin/lessees/*` (create, update, portal-invite, revoke-portal, upload-photo, check-email-duplicate)
- `app/api/admin/maintenance/*` (create, update-status, landlord-decision, upload-photo, upload-completion-photo)
- `app/api/admin/payouts/generate|mark-remitted/route.ts`
- `app/api/admin/platform-billing/update-pricing/route.ts`
- `app/api/admin/properties/*` (create, update, delete, upload-photo, units CRUD)
- `app/api/admin/rent-ledger/*` (generate, record-payment, verify-payment, one-time-charge)
- `app/api/admin/support-tickets/update/route.ts`
- `app/api/admin/tenants/*` (custom-price, mark-active, update-pricing, update-status, waive-billing)
- `app/api/admin/users/*` (create, update, delete, deactivate, invite, resend-invite, reset-password, delete-dependencies, business-unit-access)
- `app/api/apply/[token]/route.ts`, `upload-id/route.ts`
- `app/api/assistant/chat/route.ts`
- `app/api/billing/checkout/initialize/route.ts`, `sms-credits/*`, `subscription/cancel/route.ts`
- `app/api/business-units/route.ts`
- `app/api/client-invoice-payments/[paymentId]/void/route.ts`
- `app/api/client-invoices/[id]/payments/route.ts`
- `app/api/cron/balance-sheet-integrity/route.ts`, `generate-rent-ledger/route.ts`
- `app/api/facility-portal/accept-invite/route.ts`
- `app/api/finance/tax-ledger/remit|undo-remit/route.ts`
- `app/api/heartbeat/route.ts`
- `app/api/hr-payroll/lock-period|release-period|reopen-period|repair-period/route.ts`
- `app/api/inventory/finished-products/upload-photo/route.ts`
- `app/api/landlord-portal/*` (accept-invite, confirm-email, signup, workspace, uploads, rent-ledger, billing, leases)
- `app/api/operations/start-rotation|approve-roster-rotation/route.ts`
- `app/api/portal/*` (accept-invite, complaints, leases, lease termination, maintenance, rent paystack)
- `app/api/push/subscribe|unsubscribe/route.ts`
- `app/api/sales/paystack/initialize|momo/*` 
- `app/api/service-contracts/[id]/route.ts`, `upload-document/route.ts`
- `app/api/signup/route.ts`
- `app/api/staff/accept-invite/route.ts`
- `app/api/storage/handbook-screenshots|tenant-logos/signed-url/route.ts`
- `app/api/supplier-contracts/route.ts`, `[id]/route.ts`, `upload-document/route.ts`
- `app/api/support-tickets/route.ts`
- `app/api/unsubscribe/[token]/route.ts`
- `app/api/webhooks/resend/route.ts`

</details>

<details>
<summary>Pages, layouts, actions (click to expand)</summary>

- Dashboard: `app/dashboard/page.tsx`, `crm/products/page.tsx`, `finance/service-contracts/[id]/edit/page.tsx`, `hr-payroll/payroll-processing/page.tsx`, `payroll-workspace-snapshot.ts`, `client-portal/contract/page.tsx`, `reports/operations-report-data.ts`, real-estate section (~30 pages), administration (~10 pages), reports/real-estate/*
- Portals: `app/portal/*`, `app/landlord-portal/*`, `app/facility-portal/*`, `app/apply/[token]/page.tsx`, `app/unsubscribe/[token]/page.tsx`, `app/pay/product-sale/callback/page.tsx`
- Auth: `app/auth/callback/route.ts`, portal/landlord/facility `login/actions.ts`
- Public redirect: `app/s/[code]/route.ts`

</details>

### `utils/` (57 files)

`admin-auth.ts`, `assistant-*`, `billing-subscription.ts`, `business-unit-document-contact.ts`, `client-document-notifications.ts`, `client-portal-notifications.ts`, `dashboard-auth.ts`, `dashboard-shell-data.ts`, `employee-in-app-notifications.ts`, `facility-portal-auth.ts`, `generate-rent-ledger.ts`, `generate-service-contract-invoices.ts`, `generate-supplier-contract-accounts-payable.ts`, `landlord-portal-auth.ts`, `landlord-portal-notifications.ts`, `lessee-announcements-admin.ts`, `lessee-portal-auth.ts`, `lessee-portal-notifications.ts`, `paystack-*`, `pdf-branding-images.ts`, `phase5e-lock.ts`, `platform-only-unit-*`, `product-sale-*`, `real-estate-document-notifications.ts`, `real-estate-staff-notifications.ts`, `rent-due-reminders.ts`, `rent-ledger-paystack.ts`, `security-notification-dismissals.ts`, `security-notifications.ts`, `service-contract-document-send.ts`, `short-links.ts`, `sms-credit*.ts`, `statutory-reminders.ts`, `supabase/admin.ts`, `tenant-*`, `tier-access.ts`, `transactional-notification-trigger.ts`, `trial-enforcement.ts`, `user-activity-log-write.ts`, `web-push-send.ts`, `business-units-server.ts`, `admin-user-business-unit-access.ts`, `tenant-management.ts`, etc.

### `lib/` (14 files)

Listed in [Direct Postgres](#direct-postgres-database_url--application-call-sites) and [lib — service-role call sites](#lib--service-role-call-sites).

---

## Comparison to phase 1 audit (July 2026)

| Phase 1 | Round 3 |
|---------|---------|
| ~15 API routes with SR | **~120+ API routes** plus pages and utils |
| Focus: `tenant_id` on writes | Same, plus portal/platform/cron/webhook surfaces |
| No crons/webhooks in table | **14 cron routes**, **2 webhooks**, Paystack-heavy utils |

New product areas since July: supplier contracts AP cron, statutory reminders, bulk import PG commit, assistant tools, push subscriptions, platform unit billing, client invoice void RPC, multi-BU switcher, short links, product-sale Paystack callback page.

---

## Recommended next steps (no code in this round)

1. Fix **NEEDS FIX** items #1–#2 immediately (public attack surface).
2. Add CI grep/check: any new `createAdminClient()` in `app/api/**` must be paired with documented tenant source in PR template.
3. Prefer `requireTenantSuperAdmin`-style **service-role tenant lookup** for all high-privilege routes.
4. Reduce SR on read-only dashboard paths where RLS is sufficient (**UNNECESSARY SERVICE ROLE** list).
5. Re-run this audit after major features (same methodology).

---

*Report generated for Security Round 3, item 1. No application code was modified except this document.*
