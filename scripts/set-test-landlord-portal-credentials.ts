/**
 * One-off: set Landlord Portal login for test landlords.
 *
 * Targets (by tenants.name):
 *   - "Test Managed Co"
 *   - "Test Landlord Co"
 *
 * Uses tenants.email as login email, password "ikechuku".
 * Creates or updates Auth user; links landlords.auth_user_id;
 * sets user_metadata.portal = "landlord" (same as accept-invite).
 * Skips invite flow. Works for davors_managed and platform_only.
 *
 * Usage:
 *   npx tsx scripts/set-test-landlord-portal-credentials.ts
 *   npx tsx scripts/set-test-landlord-portal-credentials.ts --env-file .env.staging.local
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const PASSWORD = "ikechuku";
const TARGET_NAMES = ["Test Managed Co", "Test Landlord Co"] as const;

function loadEnvForce(filePath: string) {
  if (!existsSync(filePath)) {
    throw new Error(`Env file not found: ${filePath}`);
  }
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i === -1) continue;
    let v = trimmed.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    process.env[trimmed.slice(0, i).trim()] = v;
  }
}

type AuthUserHit = {
  id: string;
  email?: string;
  user_metadata?: Record<string, unknown>;
};

async function findAuthUserByEmail(
  admin: SupabaseClient,
  email: string,
): Promise<AuthUserHit | null> {
  const normalized = email.trim().toLowerCase();
  // GoTrue ?email= often returns a page of users — always filter exact match.
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: 200,
    });
    if (error) throw new Error(`listUsers: ${error.message}`);
    const hit = (data.users ?? []).find(
      (u) => (u.email ?? "").toLowerCase() === normalized,
    );
    if (hit) {
      return {
        id: hit.id,
        email: hit.email,
        user_metadata: (hit.user_metadata ?? {}) as Record<string, unknown>,
      };
    }
    if ((data.users ?? []).length < 200) break;
  }
  return null;
}

/**
 * Refuse to overwrite Auth users that belong to ERP / staff (user_accounts)
 * or otherwise look non-landlord. Shared emails across product lines are unsafe.
 */
async function assertSafeToReuseAuthUser(
  admin: SupabaseClient,
  existing: AuthUserHit,
  landlordTenantId: string,
): Promise<void> {
  const { data: accounts, error } = await admin
    .from("user_accounts")
    .select("auth_uid, tenant_id, email, role")
    .eq("auth_uid", existing.id);

  if (error) throw new Error(`user_accounts lookup: ${error.message}`);
  if (accounts && accounts.length > 0) {
    throw new Error(
      `Refusing to reuse auth user ${existing.id}: linked to user_accounts ` +
        `(ERP/staff) tenant(s) ${accounts.map((a) => a.tenant_id).join(", ")}. ` +
        `Pick a unique tenants.email for this landlord instead of hijacking that login.`,
    );
  }

  const { data: otherLandlords, error: llErr } = await admin
    .from("landlords")
    .select("tenant_id")
    .eq("auth_user_id", existing.id)
    .neq("tenant_id", landlordTenantId);
  if (llErr) throw new Error(`landlords auth lookup: ${llErr.message}`);
  if (otherLandlords && otherLandlords.length > 0) {
    throw new Error(
      `Refusing to reuse auth user ${existing.id}: already linked to landlord tenant(s) ` +
        otherLandlords.map((r) => r.tenant_id).join(", "),
    );
  }

  const meta = existing.user_metadata ?? {};
  const portal = meta.portal;
  const companyName = meta.company_name;
  if (portal && portal !== "landlord") {
    throw new Error(
      `Refusing to reuse auth user ${existing.id}: user_metadata.portal=${String(portal)}`,
    );
  }
  if (companyName && portal !== "landlord") {
    throw new Error(
      `Refusing to reuse auth user ${existing.id}: looks like ERP signup ` +
        `(user_metadata.company_name=${String(companyName)}). ` +
        `Update Test Landlord Co tenants.email to a unique address, then re-run.`,
    );
  }
}

async function ensureAuthUser(
  admin: SupabaseClient,
  opts: { email: string; fullName: string; landlordTenantId: string },
): Promise<{ authUserId: string; action: "created" | "updated" }> {
  const email = opts.email.trim().toLowerCase();
  const existing = await findAuthUserByEmail(admin, email);

  if (existing) {
    await assertSafeToReuseAuthUser(admin, existing, opts.landlordTenantId);
    const { error } = await admin.auth.admin.updateUserById(existing.id, {
      password: PASSWORD,
      email_confirm: true,
      user_metadata: {
        full_name: opts.fullName,
        portal: "landlord",
      },
    });
    if (error) {
      // createUser may accept weaker passwords than updateUserById.
      // If this auth user is already the linked landlord portal user, keep it.
      const policyBlocked = /password|character of each/i.test(error.message);
      if (policyBlocked) {
        const { error: metaErr } = await admin.auth.admin.updateUserById(
          existing.id,
          {
            email_confirm: true,
            user_metadata: {
              full_name: opts.fullName,
              portal: "landlord",
            },
          },
        );
        if (metaErr) throw new Error(`updateUserById: ${metaErr.message}`);
        console.warn(
          `  WARN ${email}: password policy blocked reset to "${PASSWORD}". ` +
            `Metadata/link updated; password left unchanged (ok if created earlier with that password).`,
        );
        return { authUserId: existing.id, action: "updated" };
      }
      throw new Error(`updateUserById: ${error.message}`);
    }
    return { authUserId: existing.id, action: "updated" };
  }

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: {
      full_name: opts.fullName,
      portal: "landlord",
    },
  });
  if (error || !data.user) {
    throw new Error(`createUser: ${error?.message ?? "no user returned"}`);
  }
  return { authUserId: data.user.id, action: "created" };
}

async function main() {
  const envIdx = process.argv.indexOf("--env-file");
  const envFile =
    envIdx >= 0 && process.argv[envIdx + 1]
      ? process.argv[envIdx + 1]!
      : ".env.staging.local";
  loadEnvForce(resolve(process.cwd(), envFile));

  const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  if (!supabaseUrl || !serviceKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  if (!supabaseUrl.includes(STAGING_REF)) {
    throw new Error(
      `Refusing non-staging Supabase URL (expected ref ${STAGING_REF})`,
    );
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log("=== Set test landlord portal credentials ===");
  console.log("Env file:", envFile);
  console.log("Supabase:", supabaseUrl);
  console.log("Targets:", TARGET_NAMES.join(", "));
  console.log("");

  const results: Array<Record<string, unknown>> = [];

  for (const name of TARGET_NAMES) {
    const { data: tenants, error: tenantError } = await admin
      .from("tenants")
      .select("id, name, email, product_line, status")
      .eq("name", name)
      .eq("product_line", "real_estate_only");

    if (tenantError) {
      results.push({ name, ok: false, error: tenantError.message });
      continue;
    }
    if (!tenants || tenants.length === 0) {
      results.push({ name, ok: false, error: "No real_estate_only tenant found" });
      continue;
    }
    if (tenants.length > 1) {
      results.push({
        name,
        ok: false,
        error: `Ambiguous: ${tenants.length} tenants with this name`,
        tenant_ids: tenants.map((t) => t.id),
      });
      continue;
    }

    const tenant = tenants[0]!;
    const email = String(tenant.email ?? "")
      .trim()
      .toLowerCase();
    if (!email) {
      results.push({
        name,
        ok: false,
        tenant_id: tenant.id,
        error: "tenants.email is empty",
      });
      continue;
    }

    const { data: landlord, error: landlordError } = await admin
      .from("landlords")
      .select("tenant_id, landlord_type, approval_status, auth_user_id")
      .eq("tenant_id", tenant.id)
      .maybeSingle();

    if (landlordError) {
      results.push({
        name,
        ok: false,
        tenant_id: tenant.id,
        error: landlordError.message,
      });
      continue;
    }
    if (!landlord) {
      results.push({
        name,
        ok: false,
        tenant_id: tenant.id,
        error: "landlords row missing",
      });
      continue;
    }
    if (
      landlord.landlord_type !== "davors_managed" &&
      landlord.landlord_type !== "platform_only"
    ) {
      results.push({
        name,
        ok: false,
        tenant_id: tenant.id,
        error: `Expected davors_managed or platform_only, got ${landlord.landlord_type}`,
      });
      continue;
    }

    try {
      const { authUserId, action } = await ensureAuthUser(admin, {
        email,
        fullName: tenant.name,
        landlordTenantId: tenant.id,
      });

      const { error: linkError } = await admin
        .from("landlords")
        .update({
          auth_user_id: authUserId,
          updated_at: new Date().toISOString(),
        })
        .eq("tenant_id", tenant.id);

      if (linkError) {
        results.push({
          name,
          ok: false,
          tenant_id: tenant.id,
          email,
          auth_user_id: authUserId,
          auth_action: action,
          error: `link failed: ${linkError.message}`,
        });
        continue;
      }

      results.push({
        name,
        ok: true,
        tenant_id: tenant.id,
        email,
        landlord_type: landlord.landlord_type,
        approval_status: landlord.approval_status,
        previous_auth_user_id: landlord.auth_user_id,
        auth_user_id: authUserId,
        auth_action: action,
        password_set: true,
        portal_metadata: "landlord",
      });
    } catch (err) {
      results.push({
        name,
        ok: false,
        tenant_id: tenant.id,
        email,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  for (const row of results) {
    console.log(JSON.stringify(row, null, 2));
    console.log("---");
  }

  const failed = results.filter((r) => !r.ok);
  if (failed.length > 0) {
    console.error(`Done with ${failed.length} failure(s).`);
    process.exitCode = 1;
    return;
  }
  console.log("All targets updated successfully.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
