/**
 * Landlord self-signup cross-persona guard tests (staging DB + optional HTTP).
 *
 *   npx tsx scripts/test-landlord-signup-cross-persona-staging.ts --env-file .env.staging.local
 */
import { execFileSync } from "node:child_process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  crossPersonaErrorMessage,
  findCrossPersonaConflictForAuthUid,
  findCrossPersonaConflictForEmail,
} from "../lib/auth/cross-persona-guard";
import { findAnyPersonaByAuthUid } from "../lib/auth/oauth-persona-resolve";
import { assert, loadEnvFromArgv } from "./lib/env";

const STAGING_APP_URL = (
  process.env.STAGING_APP_URL ??
  "https://dfoms-erp-git-staging-davorsghs-projects.vercel.app"
).replace(/\/$/, "");
const TEST_PASSWORD = "LandlordXPersona-Test-9Qx!";

type TestResult = { name: string; pass: boolean; detail: string };
const results: TestResult[] = [];

function record(name: string, pass: boolean, detail: string) {
  results.push({ name, pass, detail });
  console.log(`[${pass ? "PASS" : "FAIL"}] ${name}${detail ? ` — ${detail}` : ""}`);
}

function resolveBypassSecret(): string | null {
  const existing = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim();
  if (existing) return existing;
  try {
    const raw = execFileSync(
      "npx",
      ["vercel", "project", "protection", "dfoms-erp", "--json"],
      { encoding: "utf8", shell: process.platform === "win32" },
    );
    const project = JSON.parse(raw.slice(raw.indexOf("{"))) as {
      protectionBypass?: Record<string, unknown>;
    };
    return Object.keys(project.protectionBypass ?? {})[0] ?? null;
  } catch {
    return null;
  }
}

function bypassHeaders(bypass: string | null): Record<string, string> {
  return bypass ? { "x-vercel-protection-bypass": bypass } : {};
}

async function simulateLandlordOAuthOpenSignup(
  admin: SupabaseClient,
  authUid: string,
  email: string,
): Promise<{ ok: true; kind: "login" } | { ok: false; error: string }> {
  const existing = await findAnyPersonaByAuthUid(admin, authUid);
  if (existing) {
    if (existing.persona === "landlord") {
      return { ok: true, kind: "login" };
    }
    const crossByAuth = await findCrossPersonaConflictForAuthUid(admin, authUid, {
      targetPersona: "landlord",
    });
    return {
      ok: false,
      error:
        crossByAuth?.detail ??
        "This sign-in is already linked to another portal account.",
    };
  }

  const crossByAuth = await findCrossPersonaConflictForAuthUid(admin, authUid, {
    targetPersona: "landlord",
  });
  if (crossByAuth) {
    return { ok: false, error: crossPersonaErrorMessage(crossByAuth) };
  }

  const crossByEmail = await findCrossPersonaConflictForEmail(admin, email, {
    targetPersona: "landlord",
  });
  if (crossByEmail) {
    return { ok: false, error: crossPersonaErrorMessage(crossByEmail) };
  }

  return { ok: true, kind: "login" };
}

async function testPasswordSignupHttp(
  email: string,
  expectSubstring: string,
  headers: Record<string, string>,
) {
  const response = await fetch(`${STAGING_APP_URL}/api/landlord-portal/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({
      name: "Cross Persona Test Landlord",
      email,
      phone: "+233200000001",
      address: "Test Address, Accra",
      password: TEST_PASSWORD,
      confirm_password: TEST_PASSWORD,
    }),
  });
  const payload = (await response.json().catch(() => null)) as {
    error?: string;
  } | null;
  const error = payload?.error ?? "";
  const pass = response.status === 409 && error.includes(expectSubstring);
  record(
    `password signup blocked (${email.slice(0, 24)}…)`,
    pass,
    pass ? error : `status=${response.status} error=${error || "(none)"}`,
  );
}

async function testLesseeUpdateGuard(
  admin: SupabaseClient,
  tenantId: string,
  lesseeId: string,
  staffEmail: string,
) {
  const conflict = await findCrossPersonaConflictForEmail(admin, staffEmail, {
    targetPersona: "lessee",
    excludeLesseeId: lesseeId,
  });
  record(
    "lessee email update cross-persona (staff email)",
    Boolean(conflict?.persona === "staff"),
    conflict?.detail ?? "no conflict",
  );

  if (!conflict) return;

  const { data: lessee } = await admin
    .from("lessees")
    .select("full_name, phone, email")
    .eq("tenant_id", tenantId)
    .eq("lessee_id", lesseeId)
    .maybeSingle();

  assert(lessee, "lessee missing for update rollback test");

  const { error: updateError } = await admin
    .from("lessees")
    .update({
      full_name: `${lessee.full_name} Updated`,
      phone: lessee.phone,
      email: lessee.email,
      updated_at: new Date().toISOString(),
    })
    .eq("tenant_id", tenantId)
    .eq("lessee_id", lesseeId);

  record(
    "lessee profile update (name only, platform_only simulation)",
    !updateError,
    updateError?.message ?? "updated",
  );
}

async function main() {
  const envFile = loadEnvFromArgv(process.argv.slice(2));
  console.log(`Using env file: ${envFile}`);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  assert(url && serviceKey, "Missing Supabase env vars");

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: staffRow } = await admin
    .from("user_accounts")
    .select("auth_uid, email")
    .eq("is_active", true)
    .not("email", "is", null)
    .limit(1)
    .maybeSingle();

  const { data: lesseeRow } = await admin
    .from("lessees")
    .select("lessee_id, tenant_id, auth_user_id, email")
    .not("auth_user_id", "is", null)
    .not("email", "is", null)
    .limit(1)
    .maybeSingle();

  const { data: landlordRow } = await admin
    .from("landlords")
    .select("tenant_id, auth_user_id")
    .not("auth_user_id", "is", null)
    .limit(1)
    .maybeSingle();

  let landlordEmail: string | null = null;
  if (landlordRow?.tenant_id) {
    const { data: tenant } = await admin
      .from("tenants")
      .select("email")
      .eq("id", landlordRow.tenant_id)
      .maybeSingle();
    landlordEmail =
      typeof tenant?.email === "string" ? tenant.email.trim().toLowerCase() : null;
  }

  assert(staffRow?.email, "Need an active staff email on staging");
  assert(lesseeRow?.email && lesseeRow.auth_user_id, "Need lessee with portal account");
  assert(landlordEmail, "Need landlord tenant email on staging");

  const staffEmail = staffRow.email.trim().toLowerCase();
  const lesseeEmail = lesseeRow.email!.trim().toLowerCase();

  // --- Email guard (password path pre-check) ---
  for (const [label, email, expect] of [
    ["staff", staffEmail, "staff ERP account"],
    ["lessee", lesseeEmail, "Tenant Portal account"],
    ["landlord", landlordEmail!, "landlord account"],
  ] as const) {
    const conflict = await findCrossPersonaConflictForEmail(admin, email, {
      targetPersona: "landlord",
    });
    record(
      `email guard / ${label}`,
      Boolean(conflict && conflict.detail.includes(expect.split(" ")[0])),
      conflict?.detail ?? "no conflict",
    );
  }

  // --- OAuth open signup simulation (auth uid paths) ---
  const staffOAuth = await simulateLandlordOAuthOpenSignup(
    admin,
    staffRow.auth_uid,
    staffEmail,
  );
  record(
    "OAuth guard / staff auth uid",
    !staffOAuth.ok && staffOAuth.error.includes("staff ERP account"),
    staffOAuth.ok ? "unexpected login" : staffOAuth.error,
  );

  const lesseeOAuth = await simulateLandlordOAuthOpenSignup(
    admin,
    lesseeRow.auth_user_id!,
    lesseeEmail,
  );
  record(
    "OAuth guard / lessee auth uid",
    !lesseeOAuth.ok && lesseeOAuth.error.includes("Tenant Portal account"),
    lesseeOAuth.ok ? "unexpected login" : lesseeOAuth.error,
  );

  const landlordOAuth = await simulateLandlordOAuthOpenSignup(
    admin,
    landlordRow!.auth_user_id!,
    landlordEmail!,
  );
  record(
    "OAuth guard / existing landlord auth uid (login semantics)",
    landlordOAuth.ok && landlordOAuth.kind === "login",
    landlordOAuth.ok ? "login allowed" : ("error" in landlordOAuth ? landlordOAuth.error : "failed"),
  );

  // --- HTTP password signup (staging deployment) ---
  const bypass = resolveBypassSecret();
  console.log("\nHTTP password signup tests against staging…");
  const httpHeaders = bypassHeaders(bypass);
  await testPasswordSignupHttp(staffEmail, "staff ERP account", httpHeaders);
  await testPasswordSignupHttp(lesseeEmail, "Tenant Portal account", httpHeaders);
  await testPasswordSignupHttp(landlordEmail!, "landlord account", httpHeaders);

  // --- Gap 2: lessee update guard on platform_only tenant ---
  const { data: platformLandlord } = await admin
    .from("landlords")
    .select("tenant_id")
    .eq("landlord_type", "platform_only")
    .eq("approval_status", "approved")
    .limit(1)
    .maybeSingle();

  if (platformLandlord?.tenant_id) {
    const { data: editableLessee } = await admin
      .from("lessees")
      .select("lessee_id")
      .eq("tenant_id", platformLandlord.tenant_id)
      .limit(1)
      .maybeSingle();

    if (editableLessee?.lessee_id) {
      await testLesseeUpdateGuard(
        admin,
        platformLandlord.tenant_id,
        editableLessee.lessee_id,
        staffEmail,
      );
    }
  }

  const failed = results.filter((row) => !row.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
