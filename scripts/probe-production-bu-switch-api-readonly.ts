/**
 * Read-only smoke test: POST /api/account/active-business-unit on production
 * after rollback. Uses ephemeral staff session (cleaned up after).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";

const PRODUCTION_URL = "https://portal.davorsfacilities.com";
const PRODUCTION_REF = "tvcurcnmasnocwdxzgvz";
const DAVORS_TENANT_ID = "00000001-0000-4000-8000-000000000001";
const ENTERPRISE_BU_ID = "3b787f50-de08-40d5-af9c-14523a63503c";
const BYPASS =
  process.env.VERCEL_AUTOMATION_BYPASS_SECRET ?? "IJ7aYbMjtmTzXvZFVY1MdDdZYAlZcIDq";

function loadEnv(filePath: string) {
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    let v = t.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    process.env[t.slice(0, i).trim()] = v;
  }
}

async function main() {
  loadEnv(resolve(".env.local.backup"));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const anon = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
  if (!url.includes(PRODUCTION_REF) || !serviceKey || !anon) {
    throw new Error("Production Supabase env missing");
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const stamp = Date.now().toString(36);
  const email = `bu-switch-probe.${stamp}@test.davors`;
  const password = `BuProbe-${stamp}!Aa8`;
  let authUid: string | null = null;

  const cleanup = async () => {
    if (!authUid) return;
    await admin.from("user_accounts").delete().eq("auth_uid", authUid);
    await admin.auth.admin.deleteUser(authUid);
  };

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { portal: "staff" },
  });
  if (createErr || !created.user) {
    throw new Error(`createUser failed: ${createErr?.message ?? "unknown"}`);
  }
  authUid = created.user.id;

  const { error: accountErr } = await admin.from("user_accounts").insert({
    auth_uid: authUid,
    email,
    role: "finance",
    is_active: true,
    tenant_id: DAVORS_TENANT_ID,
    view_all_business_units: true,
    active_business_unit_id: null,
  });
  if (accountErr) {
    await cleanup();
    throw new Error(`user_accounts insert failed: ${accountErr.message}`);
  }

  const cookieStore: { name: string; value: string }[] = [];
  const sessionClient = createServerClient(url, anon, {
    cookies: {
      getAll() {
        return cookieStore;
      },
      setAll(cookiesToSet) {
        for (const cookie of cookiesToSet) {
          const index = cookieStore.findIndex((row) => row.name === cookie.name);
          if (index >= 0) cookieStore[index] = { name: cookie.name, value: cookie.value };
          else cookieStore.push({ name: cookie.name, value: cookie.value });
        }
      },
    },
  });

  const { error: signErr } = await sessionClient.auth.signInWithPassword({
    email,
    password,
  });
  if (signErr || cookieStore.length === 0) {
    await cleanup();
    throw new Error(`signIn failed: ${signErr?.message ?? "no cookies"}`);
  }

  const cookieHeader = cookieStore.map((c) => `${c.name}=${c.value}`).join("; ");

  const headersRes = await fetch(`${PRODUCTION_URL}/login`, {
    headers: {
      Cookie: cookieHeader,
      "x-vercel-protection-bypass": BYPASS,
    },
    redirect: "manual",
  });

  const probeRes = await fetch(`${PRODUCTION_URL}/api/account/active-business-unit`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookieHeader,
      "x-vercel-protection-bypass": BYPASS,
    },
    body: JSON.stringify({
      selection: "unit",
      business_unit_id: ENTERPRISE_BU_ID,
      view_all_business_units: false,
    }),
  });

  const probeBody = await probeRes.text();
  let probeJson: unknown = null;
  try {
    probeJson = JSON.parse(probeBody);
  } catch {
    probeJson = probeBody.slice(0, 500);
  }

  console.log(
    JSON.stringify(
      {
        production_url: PRODUCTION_URL,
        login_status: headersRes.status,
        response_headers: {
          "x-vercel-id": headersRes.headers.get("x-vercel-id"),
          "x-vercel-cache": headersRes.headers.get("x-vercel-cache"),
        },
        active_business_unit_api: {
          status: probeRes.status,
          body: probeJson,
          has_user_business_unit_access_error:
            typeof probeBody === "string" &&
            probeBody.includes("user_business_unit_access"),
        },
      },
      null,
      2,
    ),
  );

  await cleanup();
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
