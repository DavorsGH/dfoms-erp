# Email-to-Tenant Mapping Investigation

**Date:** 2026-08-23  
**Scope:** READ-ONLY audit of what enforces “one email = one tenant” today for **staff** (`user_accounts`) and **lessees** (`lessees`), plus cross-persona rules. Goal is to inform **sequential-only** email reuse (one active membership at a time; no concurrent multi-tenant access, no JWT tenant switcher).

---

## Executive summary

“One email = one tenant” is **not** a single database constraint. It is enforced by a **stack of layers**:

| Layer | Staff | Lessee |
|-------|-------|--------|
| **Supabase Auth** | One `auth.users` row per email (global) | Same |
| **Persona table PK/UNIQUE** | `user_accounts_pkey (auth_uid)` — one staff row per auth identity | `idx_lessees_auth_user_id` — one lessee row per auth identity |
| **App cross-persona guard** | Blocks email/auth already used in staff, lessee, or landlord | Same |
| **Signup/invite flows** | Always call `auth.admin.createUser` (except OAuth re-login) | Invite-only; password accept calls `createUser` |
| **Tenant resolution** | `auth.uid()` → single `user_accounts` row → `tenant_id` | `auth.uid()` → single `lessees` row → `tenant_id` (landlord) |

**Sequential reuse is blocked today** even after offboarding, because:

1. **Staff:** Inactive `user_accounts` rows still match cross-persona email checks and still occupy the sole PK slot for that `auth_uid`.
2. **Lessee:** `auth_user_id` stays on the old lessee row after lease end unless manually cleared; the global unique index prevents linking the same auth user to a new lessee row.
3. **Cross-persona:** `findCrossPersonaConflictForEmail` / `findCrossPersonaConflictForAuthUid` do **not** filter on `is_active` or lessee `status`, so a deactivated staff account still blocks a lessee invite for the same email.

The minimal path forward (Section 11) reuses the **same Supabase Auth identity** and **moves** the active membership row (staff: update `user_accounts`; lessee: clear old link, set new link) rather than introducing concurrent rows, JWT `active_tenant` claims, or a switcher UI.

---

## 1. Staff: `user_accounts` schema

### Table definition (effective)

Base DDL lives in `schema-only.sql` (stale dump — missing `tenant_id`). Incremental migrations define the live shape:

| Column | Notes |
|--------|-------|
| `auth_uid` uuid **NOT NULL** | Primary key |
| `tenant_id` uuid **NOT NULL** | Added in `scripts/59_tenant_isolation_foundation.sql` |
| `role` `app_role` NOT NULL | Default `super_admin`; extended in `scripts/47_rbac_foundation.sql` |
| `employee_id` text nullable | FK → `employees(employee_id)` |
| `client_id` text nullable | FK → `clients` / `customers` |
| `email` text nullable | **No unique constraint** |
| `is_active` boolean NOT NULL DEFAULT true | Only staff deactivation flag |
| `created_at` timestamptz | |

```6613:6621:schema-only.sql
CREATE TABLE public.user_accounts (
    auth_uid uuid NOT NULL,
    employee_id text,
    role public.app_role DEFAULT 'super_admin'::public.app_role NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    email text,
    client_id text
);
```

### Primary key and unique constraints

- **PK:** `user_accounts_pkey PRIMARY KEY (auth_uid)` — `auth_uid` is the **sole** primary key; at most **one** `user_accounts` row per Supabase Auth user globally.
- **Unique constraints:** Only the PK. No DB uniqueness on `email`, `(tenant_id, email)`, or `(tenant_id, employee_id)`.
- **Indexes:** `idx_user_accounts_tenant_id`, `idx_user_accounts_employee_id`, `idx_user_accounts_client_id`.

### Foreign keys

- `user_accounts_employee_id_fkey` → `employees(employee_id)`
- `user_accounts_client_id_fkey` → `clients(client_id)` (live FK target may be `customers` after renames)
- `tenant_id` → `tenants(id)` (script 59)

Child tables (e.g. `user_account_supervisor_sites`, `leave_approver_config`) reference `auth_uid` scoped by `tenant_id` in application code.

### RLS (staff tenant boundary)

`scripts/60_tenant_rls_policies.sql`:

- `user_accounts_select` — `tenant_matches(tenant_id)` and (`auth_uid = auth.uid()` OR super_admin)
- `user_accounts_write` — super_admin in tenant only

---

## 2. Staff: signup flow and duplicate-email failures

### Path A — Open tenant signup (password)

`app/signup/page.tsx` → `POST /api/signup` (`app/api/signup/route.ts`):

1. `validateSignupInput` (`utils/tenant-signup.ts`)
2. **`admin.auth.admin.createUser({ email, password, ... })`** — first hard gate
3. On failure, `isDuplicateEmailError()` maps Auth errors to *“An account with this email already exists.”*
4. `provisionStaffTenantSignup()` inserts `tenants`, **`user_accounts`**, seeds, Davors customer row

```29:48:app/api/signup/route.ts
  const { data: authData, error: authError } = await admin.auth.admin.createUser({
    email: adminEmail,
    password,
    email_confirm: false,
    user_metadata: {
      full_name: adminFullName,
      company_name: companyName,
      portal: "staff",
    },
  });

  if (authError || !authData.user) {
    return NextResponse.json(
      {
        error: isDuplicateEmailError(authError?.message ?? "")
          ? "An account with this email already exists."
          : mapSupabasePasswordError(authError ?? { message: "Failed to create auth user." }),
      },
      { status: 400 },
    );
  }
```

**Failure when email exists under Tenant A and user tries open signup for Tenant B:** Supabase Auth rejects duplicate email. No app-level cross-tenant check runs because Auth fails first. This path always creates a **new tenant** — it is not “join existing tenant B.”

### Path B — Open tenant signup (OAuth)

`app/auth/start/route.ts` → `lib/auth/oauth-callback-dispatch.ts`:

- If `findAnyPersonaByAuthUid` finds an **existing staff** persona, OAuth **reuses** the session and redirects to dashboard (no new tenant).
- New signup calls `provisionStaffTenantSignup` with the **existing** OAuth `authUid` (no second Auth user).

### Path C — Admin create user (password, existing tenant)

`app/dashboard/administration/user-accounts.tsx` → `POST /api/admin/users/create` (`app/api/admin/users/create/route.ts`):

1. `requireTenantSuperAdmin`
2. `ensureEmployeeAvailable` / `ensureClientAvailable` (tenant-scoped)
3. **`admin.auth.admin.createUser`** — duplicate email fails here
4. Insert `user_accounts`

**Gap:** Does **not** call `ensureEmailAvailable`, `findCrossPersonaConflictForEmail`, or tenant-global staff email checks. Relies entirely on Supabase Auth duplicate rejection.

### Path D — Admin invite (email link)

Send: `POST /api/admin/users/invite` → `createAndSendStaffPortalInvite` (`utils/staff-portal-invite.ts`)

Accept (password): `POST /api/staff/accept-invite` → `acceptStaffPortalInviteWithPassword`

Accept (OAuth): `lib/auth/oauth-invite-accept.ts` → `acceptStaffInviteWithOAuth`

**Invite validation** (`validateStaffInviteRoleInput`):

1. `findCrossPersonaConflictForEmail(admin, email)` — **global**, any `user_accounts` row with matching email (any tenant, **any** `is_active`)
2. Tenant-scoped duplicate: `user_accounts` where `tenant_id = invite.tenant_id` AND `ilike email`

**Invite accept** (`acceptStaffPortalInviteWithPassword`):

1. Repeat cross-persona + tenant email checks
2. `admin.auth.admin.createUser` — fails if Auth email exists
3. Insert `user_accounts` with new `auth_uid`

```108:131:utils/staff-portal-invite.ts
  const crossPersona = await findCrossPersonaConflictForEmail(admin, email);
  if (crossPersona) {
    return {
      ok: false,
      error: crossPersonaErrorMessage(crossPersona),
      status: 409,
    };
  }

  const { data: existingStaff } = await admin
    .from("user_accounts")
    .select("auth_uid")
    .eq("tenant_id", input.tenantId)
    .ilike("email", email)
    .maybeSingle();

  if (existingStaff) {
    return {
      ok: false,
      error:
        "A staff account with this email already exists in your organization.",
      status: 409,
    };
  }
```

### Summary: what fails for “email registered under Tenant A → signup under Tenant B”

| Flow | Supabase Auth duplicate | App-level block |
|------|-------------------------|-----------------|
| Open signup (new company) | **Yes** — `createUser` | — |
| OAuth open signup | Reuses existing Auth user if same Google/email | `provisionStaffTenantSignup` may fail on slug/other business rules |
| Staff invite to Tenant B | **Yes** — `createUser` on accept | **Yes** — cross-persona global email + tenant email |
| Admin create on Tenant B | **Yes** — `createUser` | Tenant-scoped employee/client only |

There is **no** “join Tenant B with existing Auth credentials” path for staff invites today.

---

## 3. Staff: login / tenant resolution

All paths assume **`auth.uid()` maps to at most one `user_accounts` row** and read `tenant_id` from that row.

### SQL helpers (SECURITY DEFINER)

| Function | File | Logic |
|----------|------|-------|
| `current_user_tenant_id()` | `scripts/60_tenant_rls_policies.sql` | `SELECT tenant_id FROM user_accounts WHERE auth_uid = auth.uid() AND is_active IS NOT FALSE` |
| `tenant_matches(p_tenant_id)` | same | Compares to `current_user_tenant_id()` |
| `current_user_role()` | `scripts/48_rbac_page_access.sql` | Same `user_accounts` filter |
| `current_user_employee_id()` | `scripts/49_employee_self_service.sql` | Same filter |
| `current_user_client_id()` | `schema-only.sql` | Same pattern |

Used by **hundreds** of RLS policies across finance, HR, inventory, Real Estate staff APIs, etc.

### Server-side TypeScript

| File | Function | Notes |
|------|----------|-------|
| `utils/dashboard-auth.ts` | `getCurrentUserAccount`, `getCurrentUserTenantId`, `getCurrentUserRole`, `getCurrentUserEmployeeId`, `getCurrentUserClientId` | `.eq("auth_uid", user.id).maybeSingle()`; trusts signed middleware context when present |
| `utils/admin-auth.ts` | `requireTenantSuperAdmin`, `requireRoleIn`, `requireSuperAdmin`, `requireTenantRoleIn` | Service-role or user client; checks `is_active` |
| `utils/session-tenant-client.ts` | `resolveSessionTenantId` | Browser client; same `user_accounts` lookup |
| `utils/session-employee-client.ts` | `resolveSessionEmployeeId` | Same pattern |
| `lib/client-cache/session-context.ts` | `resolveClientCacheSession` | Composes tenant + employee |
| `lib/auth/oauth-persona-resolve.ts` | `findStaffPersonaByAuthUid` | Admin OAuth; ignores inactive |
| `utils/client-portal-auth.ts` | Client portal session | Uses `getCurrentUserTenantId()` |
| `utils/push-subscription-auth.ts` | Staff branch | `getCurrentUserTenantId()` |
| `utils/tier-access.ts`, `utils/billing-settings-load.ts` | Tier/billing gates | `getCurrentUserTenantId()` |
| `utils/user-activity-log-write.ts` | Activity log tenant | Looks up `user_accounts.tenant_id` by `auth_uid` |
| `middleware.ts` | Loads `accountRow` | Signs HMAC `AUTH_CONTEXT_HEADER` with `tenantId`, `role`, etc. |

### Middleware (`middleware.ts`)

```211:226:middleware.ts
  if (user && (needsAccountGate || needsPersonaCheck)) {
    const { data: account } = await supabase
      .from("user_accounts")
      .select("is_active, tenant_id, role, employee_id, client_id")
      .eq("auth_uid", user.id)
      .maybeSingle();
    // ...
    if (needsAccountGate && accountRow?.is_active === false) {
      await supabase.auth.signOut();
      // redirect to /login
    }
  }
```

Signed context is attached for `/dashboard/*` when `is_active !== false` (`middleware.ts` ~398–418).

### Persona routing (`lib/middleware-persona.ts`)

- Reads `user_metadata.portal` first.
- On `/dashboard/*` with a staff `accountRow`, skips lessee/landlord probes.
- Otherwise parallel-probes `lessees` and `landlords` by `auth_user_id` (`.maybeSingle()` each).

---

## 4. Staff: departure / deactivation

### Deactivation mechanism

Only **`user_accounts.is_active`**. No `deactivated_at`, no link to `employees.employment_status`.

| Entry point | File |
|-------------|------|
| Deactivate API | `app/api/admin/users/deactivate/route.ts` — sets `is_active: false` |
| Edit user | `app/api/admin/users/update/route.ts` — accepts `is_active` |
| UI | `app/dashboard/administration/user-accounts.tsx` |

### Runtime effect of `is_active = false`

- **Middleware:** sign-out + redirect to `/login` on gated paths.
- **`requireRoleIn` / `requireTenantSuperAdmin`:** 403 Forbidden.
- **`current_user_tenant_id()` and related SQL helpers:** return NULL (`is_active IS NOT FALSE` filter).
- **`findStaffPersonaByAuthUid`:** returns null.

### Can a deactivated employee still log in?

**Auth credentials still work** at the Supabase layer, but the next request hitting middleware account gate **signs them out**. They cannot access dashboard APIs or pass RLS as staff.

### `employees.employment_status`

**Not coupled** to `user_accounts.is_active`. Setting employment to terminated does not deactivate login; deactivating login does not update employment.

### Account delete vs deactivate

`utils/admin-user-delete.ts` → `deleteUserAccount`:

- Deletes `user_accounts` row (tenant-scoped)
- **`admin.auth.admin.deleteUser(authUid)`** — removes Auth identity entirely

Deleting (vs deactivating) **precludes** sequential reuse of the same email without a full re-registration flow that creates a new Auth user.

---

## 5. Lessee: `lessees` schema

### CREATE TABLE

No `CREATE TABLE lessees` in tracked migrations — table predates numbered scripts (Real Estate baseline DDL).

### Inferred columns (from app + migrations)

| Column | Notes |
|--------|-------|
| `tenant_id` uuid | Landlord tenant |
| `lessee_id` uuid | Business key (with `tenant_id`) |
| `auth_user_id` uuid nullable | Linked on portal invite accept |
| `full_name`, `phone`, `email` | Contact |
| `status` | `"active"` \| `"former"` (`lessees-utils.ts`) |
| `private_notes`, `photo_url`, timestamps | |

### Keys and indexes

| Name | Definition | File |
|------|------------|------|
| **`lessees_tenant_id_lessee_id_key`** | UNIQUE `(tenant_id, lessee_id)` | `scripts/138_lessee_announcements.sql` |
| **`idx_lessees_auth_user_id`** | **Partial UNIQUE** `(auth_user_id) WHERE auth_user_id IS NOT NULL` | `scripts/164_security_deposits_landlord_rls_lessees_auth_unique.sql` |

Script 164 comment: *“Enforce one lessee row per auth user (`current_user_lessee_id()` determinism)”* — mirrors `idx_landlords_auth_user_id`. Pre-migration duplicate check raises if any `auth_user_id` appears on multiple rows.

**Note:** No file in the repo references a “2026-08-04 leakage audit” by name. Script 164 is the documented defense-in-depth hardening for lessee auth uniqueness.

---

## 6. Lessee: signup / invite flow

**No self-signup.** Portal access is invite-only.

### Flow

1. Staff/landlord creates lessee (`auth_user_id: null`) — `app/api/admin/lessees/create/route.ts`, `utils/lease-create.ts`
2. `createAndSendLesseePortalInvite()` — `utils/lessee-portal-invite.ts` (skips if no email or `auth_user_id` already set)
3. Email link → `/portal/accept-invite`
4. Accept:
   - **Password:** `POST /api/portal/accept-invite` (`app/api/portal/accept-invite/route.ts`)
   - **OAuth:** `acceptLesseeInviteWithOAuth` (`lib/auth/oauth-invite-accept.ts`)

### Password accept (no cross-persona pre-check)

```96:122:app/api/portal/accept-invite/route.ts
  const { data: created, error: createError } =
    await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: lessee.full_name,
        portal: "lessee",
      },
    });

  if (createError || !created.user) {
    const message = createError?.message ?? "Unable to create portal account.";
    if (/already|registered|exists/i.test(message)) {
      return NextResponse.json(
        {
          error:
            "An account with this email already exists. Try logging in, or contact support if you need help.",
        },
        { status: 400 },
      );
    }
```

Then `UPDATE lessees SET auth_user_id = ... WHERE auth_user_id IS NULL`.

### OAuth accept (cross-persona enforced)

`acceptLesseeInviteWithOAuth` calls:

- `findCrossPersonaConflictForAuthUid(..., { targetPersona: "lessee" })`
- `findCrossPersonaConflictForEmail(..., { targetPersona: "lessee" })`

Then links existing OAuth user — **no** `createUser`.

### Failure when email already exists

| Existing registration | Password invite | OAuth invite |
|----------------------|-----------------|--------------|
| Lessee (other landlord), linked | Auth `createUser` fails → generic “already exists” | Blocked by cross-persona (email + auth) |
| Staff account (any tenant) | Auth `createUser` fails | Blocked by cross-persona |
| Landlord account | Auth `createUser` fails | Blocked by cross-persona |
| Same lessee already linked | “already has a portal account” (pre-check) | Same |

**Gap:** Password lessee accept does not call `findCrossPersonaConflictForEmail` before `createUser` (OAuth path does).

Email update on existing lessee: `app/api/landlord-portal/lessees/update/route.ts` calls cross-persona with `excludeLesseeId`.

---

## 7. Lessee: tenant portal resolution

**Chain:** `auth.uid()` → `lessees.auth_user_id` → `(tenant_id, lessee_id)` where `tenant_id` is the **landlord’s** tenant.

### SQL

```53:65:scripts/131_lessee_portal_foundation.sql
CREATE OR REPLACE FUNCTION public.current_user_lessee_id()
RETURNS uuid
...
  SELECT l.lessee_id
  FROM public.lessees l
  WHERE l.auth_user_id = auth.uid()
  ORDER BY l.created_at ASC
  LIMIT 1;
```

`is_lessee_portal_user()` → `current_user_lessee_id() IS NOT NULL`.

There is **no** separate “landlord tenant for lessee” SQL function — landlord tenant **is** `lessees.tenant_id`.

### Application

| File | Function | Lookup |
|------|----------|--------|
| `utils/lessee-portal-auth.ts` | `getPortalLesseeSession` | `.eq("auth_user_id", user.id).maybeSingle()` + ban check |
| `app/portal/login/actions.ts` | `portalLoginWithPassword` | Same + wrong-portal guard |
| `lib/middleware-persona.ts` | Persona probe | `.eq("auth_user_id", user.id).maybeSingle()` |
| `lib/auth/oauth-persona-resolve.ts` | `findLesseePersonaByAuthUid` | Same |
| `utils/push-subscription-auth.ts` | Lessee branch | Via portal session |

### RLS policies assuming one lessee per auth user

All use `current_user_lessee_id()` (deterministic after script 164 unique index):

| Policy | Table | Script |
|--------|-------|--------|
| `lessee_portal_select_own_lessee` | `lessees` | 131 |
| `lessee_portal_select_own_leases` | `leases` | 131 |
| `lessee_portal_select_own_rent_ledger` | `rent_ledger` | 131 |
| `lessee_portal_select_own_units` | `property_units` | 131 |
| `lessee_portal_select_own_properties` | `properties` | 131 |
| `lessee_portal_select_own_security_deposits` | `security_deposits` | 158 |
| `lessee_portal_select_own_complaints` | `lessee_complaints` | 134 |
| `lessee_portal_select_own_maintenance` | `maintenance_requests` | 134 |
| `lessee_notifications_select/update/delete_own` | `lessee_notifications` | 138, 150 |

Notifications policies also require `recipient_user_id = auth.uid() AND lessee_id = current_user_lessee_id()`.

Staff policies on the same tables (`*_tenant_*` in `scripts/132_real_estate_tenant_matches_rls.sql`) use `tenant_matches(tenant_id)` and are **additive** (Postgres ORs policies).

Portal **writes** use service-role API routes (maintenance, complaints, termination requests), not lessee JWT inserts.

---

## 8. Lessee: lease end / portal lifecycle

### Manual portal deactivation (landlord)

`deactivateLesseePortalAccess` (`utils/lessee-portal-account-management.ts`):

- Sets Auth `ban_duration: "876000h"` (~100 years)
- Global sign-out
- **Does not** clear `lessees.auth_user_id`

Login blocked via `isAuthUserBanned(banned_until)` in portal login and `getPortalLesseeSession`.

### Lease termination / natural end

`terminateLeaseEarly` (`utils/lease-management.ts`):

- Sets `leases.status = 'terminated_early'`, unit → `vacant`
- **Does not** ban Auth, clear `auth_user_id`, or set `lessees.status = 'former'`

No cron found that sets `leases.status = 'expired'` or revokes portal access when `end_date` passes. Rent ledger cron skips post-end periods only.

### Portal UX without active lease

`fetchPortalDashboardData` filters `leases.status = 'active'`. Dashboard shows *“No active lease was found”* — user **can still log in** unless Auth-banned.

### `lessees.status` (`active` / `former`)

Updatable via staff/landlord APIs. **Not wired** to login, RLS, or invite acceptance.

---

## 9. Cross-cutting: same email as staff AND lessee

### Designed rule

`lib/auth/cross-persona-guard.ts` header:

> *One email may only belong to one portal persona (staff OR lessee OR landlord).*

Checks:

- **Email:** any `user_accounts.email` match (global, no `is_active` filter); any `lessees.email` with non-null `auth_user_id`; landlord via `tenants.email` + `landlords.auth_user_id`
- **Auth UID:** any row in `user_accounts`, `lessees`, or `landlords` for that `auth_uid`

### Can it happen today?

**Not through normal invite/signup flows** — guards on staff invite, OAuth invite accept, landlord signup, and lessee OAuth accept block it.

**Theoretically possible** via service-role bypass or partial paths (e.g. password lessee accept before Auth exists for staff, then staff invite — second step would still fail on cross-persona or Auth duplicate).

### What breaks if both existed (same `auth_uid`)

- **Middleware persona:** ambiguous; metadata + probes pick one portal.
- **Login routes:** staff `/login` vs `/portal/login` each expect different table linkage; wrong portal → sign-out / error.
- **RLS:** staff policies use `current_user_tenant_id()`; lessee policies use `current_user_lessee_id()` — same JWT could satisfy both if both rows exist (critical data-leak risk). Cross-persona guard exists specifically to prevent this.

### Sequential staff → lessee (or reverse)

Blocked today even with `is_active = false` staff row, because cross-persona checks **ignore** `is_active`.

---

## 10. Sequential reuse: constraint and assumption violations

Target design: **one Auth identity, one active membership per side**, reuse email after prior membership ends. No concurrent tenants, no switcher, no JWT tenant claim.

### Risk matrix

| # | Finding | Risk | Why |
|---|---------|------|-----|
| 1 | **`user_accounts_pkey (auth_uid)`** — single row per Auth user | **Critical** | Cannot store Tenant A + Tenant B history as two rows; cross-tenant move must **UPDATE** same row or delete then recreate (same uid) |
| 2 | **`idx_lessees_auth_user_id` UNIQUE** — one linked lessee per Auth user | **Critical** | New landlord requires **clearing** old `auth_user_id` before linking |
| 3 | **Supabase Auth one email → one user** | **Critical** | Sequential reuse must **reuse** Auth user, not `createUser` again |
| 4 | **`findCrossPersonaConflictForEmail/AuthUid` ignores `is_active` / lessee status** | **Critical** | Deactivated staff still blocks lessee invite; inactive staff blocks staff re-invite to new tenant |
| 5 | **All staff tenant resolution uses single-row `maybeSingle()` on `auth_uid`** | **Critical** | Safe while one row; breaks if multi-row membership added without resolver change |
| 6 | **`current_user_tenant_id()` single-row SELECT** | **Critical** | Same; drives most tenant RLS |
| 7 | **`current_user_lessee_id()` + `.maybeSingle()` lessee lookups** | **Critical** | Assumes ≤1 linked lessee; mitigated by unique index but logic must pick **active** lessee after reuse |
| 8 | **Staff invite / admin create always `createUser`** | **Medium** | Must add “existing Auth → link/reprovision” branch |
| 9 | **Password lessee accept always `createUser`** | **Medium** | Must add “existing Auth → link” like OAuth path |
| 10 | **`deleteUserAccount` deletes Auth user** | **Medium** | Offboarding must prefer deactivate + clear links, not delete, for reuse |
| 11 | **`user_metadata.portal` routing** | **Medium** | Must update on persona/tenant move (`syncAuthUserPortalMetadata`) |
| 12 | **FK children keyed by `auth_uid` + `tenant_id`** (supervisor sites, leave config) | **Medium** | Tenant move must scrub or migrate tenant-scoped rows |
| 13 | **`current_user_lessee_id()` ORDER BY created_at** | **Low** | Redundant after unique index; should filter `status = 'active'` for clarity |
| 14 | **No unique on `user_accounts.email`** | **Low** | App checks only; service-role could insert duplicates per tenant (latent) |
| 15 | **`employees.employment_status` decoupled** | **Low** | Operational inconsistency, not a security boundary |

---

## 11. Recommended minimal plan (sequential-only)

**Principles:** Keep one Supabase Auth user per email. Keep **one active staff binding** and **one active lessee binding** per Auth user. Move bindings on transition — no second row, no switcher, no JWT tenant claim.

### Phase 0 — Policy definitions

1. **Active staff membership:** `user_accounts.is_active = true` (existing).
2. **Active lessee membership:** `lessees.auth_user_id IS NOT NULL` AND `status = 'active'` AND Auth not banned (extend as needed).
3. **Offboarding:** staff → `is_active = false`; lessee → clear `auth_user_id` (and/or ban) + set `status = 'former'`.

### Phase 1 — Database (single migration)

**Staff:** Keep PK on `auth_uid` (no memberships table required for sequential-only).

- Add partial unique index (optional defense-in-depth):  
  `CREATE UNIQUE INDEX ... ON user_accounts (auth_uid) WHERE is_active` — *already implied by PK if only one row exists*; real constraint is **one row total** today.
- For audit without concurrent rows: add nullable `ended_at timestamptz` on `user_accounts` (optional) OR rely on external HR records.

**Lessee:**

- **Keep** global unique on `auth_user_id` WHERE NOT NULL (supports sequential reuse after NULL-out).
- Update `current_user_lessee_id()` to:  
  `WHERE auth_user_id = auth.uid() AND status = 'active' LIMIT 1`  
  (remove `ORDER BY created_at` dependency).

**No** `active_tenant` JWT claim. **No** switcher UI.

### Phase 2 — Cross-persona guard

Update `findCrossPersonaConflictForEmail`:

- Staff conflict: only rows with `is_active = true`
- Lessee conflict: only rows with `auth_user_id IS NOT NULL` AND `status = 'active'` (and not excluded id)

Update `findCrossPersonaConflictForAuthUid`:

- Same active-only filters

Add **`allowInactiveStaffReuse`** flag only where needed for explicit re-provision flows (internal, not user-facing switcher).

### Phase 3 — Staff re-provision flow (join new tenant)

Extend `acceptStaffPortalInviteWithPassword`, OAuth staff invite accept, and optionally admin create:

```
IF auth user exists for email:
  IF user_accounts row exists AND is_active:
    reject (already employed / active)
  IF user_accounts row exists AND NOT is_active:
    UPDATE user_accounts SET tenant_id, role, employee_id, email, is_active=true, ...
    scrub tenant-scoped supervisor sites / leave approver for OLD tenant
  ELSE IF no user_accounts row (lessee/landlord-only history):
    INSERT user_accounts (reuse auth_uid)
ELSE:
  createUser + INSERT (today's path)
```

**Open signup** (`/api/signup`) stays “new company only” — still blocked by Auth if email exists (by design).

**Tenant move side effect:** historical audit logs tied to old `tenant_id` + same `auth_uid` remain valid; supervisor/approver roles must be re-synced for new tenant.

### Phase 4 — Lessee re-provision flow (new landlord)

On **lease end / offboarding** (automate or admin action):

1. `deactivateLesseePortalAccess` (ban) — optional
2. **`UPDATE lessees SET auth_user_id = NULL, status = 'former'`** — required for reuse
3. Invalidate outstanding invites

Extend **password** `POST /api/portal/accept-invite`:

- Mirror OAuth: cross-persona checks (active only)
- If Auth user exists: **link** (`UPDATE lessees SET auth_user_id = ...`) instead of `createUser`
- If link fails unique index → surface “account still linked elsewhere” (ops must clear old lessee)

### Phase 5 — Resolver hardening

- `getCurrentUserAccount` / middleware: if row exists but `is_active = false`, treat as no staff account (already mostly true).
- `getPortalLesseeSession`: require `status = 'active'`.
- `findStaffPersonaByAuthUid` / `findLesseePersonaByAuthUid`: align with active-only rules.

### Phase 6 — Tests (staging)

Reuse/extend patterns from `scripts/test-landlord-signup-cross-persona-staging.ts`, `scripts/test-staff-portal-invite-staging.ts`:

1. Staff Tenant A → deactivate → invite Tenant B → login succeeds, `tenant_id` is B
2. Lessee Landlord A → clear link → invite Landlord B → portal login, correct lease data
3. Staff active + lessee invite same email → still **rejected** (concurrent)
4. Deactivated staff + lessee invite → **allowed** after Phase 2
5. RLS smoke: lessee sees only new landlord data; staff sees only new tenant

### Explicit non-goals (per requirements)

- No multi-row concurrent `user_accounts` per `auth_uid`
- No tenant switcher UI
- No JWT custom claims for `active_tenant`
- No concurrent active memberships on staff and lessee sides for the same Auth user

---

## Appendix A — Staff signup entry points (quick reference)

| Path | Entry | Auth creation | `user_accounts` insert |
|------|-------|---------------|------------------------|
| Open signup | `app/api/signup/route.ts` | `createUser` | `provisionStaffTenantSignup` |
| OAuth signup | `lib/auth/oauth-callback-dispatch.ts` | Pre-existing OAuth | `provisionStaffTenantSignup` |
| Admin create | `app/api/admin/users/create/route.ts` | `createUser` | Direct insert |
| Staff invite | `utils/staff-portal-invite.ts` | `createUser` on accept | Direct insert |

## Appendix B — Lessee portal entry points

| Step | File |
|------|------|
| Create lessee | `app/api/admin/lessees/create/route.ts`, `utils/lease-create.ts` |
| Send invite | `utils/lessee-portal-invite.ts` |
| Accept (password) | `app/api/portal/accept-invite/route.ts` |
| Accept (OAuth) | `lib/auth/oauth-invite-accept.ts` |
| Login | `app/portal/login/actions.ts` |
| Session | `utils/lessee-portal-auth.ts` |
| Deactivate | `app/api/landlord-portal/lessee-accounts/deactivate/route.ts` |

## Appendix C — Cross-persona guard call sites

| Caller | Persona target |
|--------|----------------|
| `utils/staff-portal-invite.ts` | staff (default) |
| `lib/auth/oauth-invite-accept.ts` | staff / lessee / landlord |
| `lib/auth/oauth-callback-dispatch.ts` | signup flows |
| `app/api/landlord-portal/signup/route.ts` | landlord |
| `app/api/landlord-portal/lessees/update/route.ts` | lessee (email change) |

---

*End of investigation. No migrations or application code were changed during this audit.*
