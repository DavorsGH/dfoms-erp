/**
 * Smoke test: POST /api/account/active-business-unit on production
 * after re-promote to 4636fb0 BU feature build.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import pg from "pg";

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

async function lookupFacilitiesBuId(): Promise<string> {
  loadEnv(resolve(".env.local.backup"));
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    const { rows } = await client.query(
      `SELECT id, name, is_active FROM business_units
       WHERE tenant_id = $1 AND name ILIKE '%facilities%'
       ORDER BY name LIMIT 5`,
      [DAVORS_TENANT_ID],
    );
    if (rows.length === 0) {
      throw new Error("Davors Facilities business unit not found on production");
    }
    return rows[0].id as string;
  } finally {
    await client.end();
  }
}

async function switchBu(
  cookieHeader: string,
  businessUnitId: string,
  label: string,
) {
  const res = await fetch(`${PRODUCTION_URL}/api/account/active-business-unit`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookieHeader,
      "x-vercel-protection-bypass": BYPASS,
    },
    body: JSON.stringify({
      selection: "unit",
      business_unit_id: businessUnitId,
      view_all_business_units: false,
    }),
  });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* keep text */
  }
  return {
    label,
    business_unit_id: businessUnitId,
    status: res.status,
    body,
    has_user_business_unit_access_error: text.includes("user_business_unit_access"),
  };
}

async function main() {
  loadEnv(resolve(".env.local.backup"));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const anon = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
  if (!url.includes(PRODUCTION_REF) || !serviceKey || !anon) {
    throw new Error("Production Supabase env missing");
  }

  const facilitiesBuId = await lookupFacilitiesBuId();

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const stamp = Date.now().toString(36);
  const email = `bu-repromote.${stamp}@test.davors`;
  const password = `BuRe-${stamp}!Aa8`;
  let authUid: string | null = null;

  const cleanup = async () => {
    if (!authUid) return;
    await admin.from("user_business_unit_access").delete().eq("auth_uid", authUid);
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

  const enterprise = await switchBu(cookieHeader, ENTERPRISE_BU_ID, "Davors Enterprise");
  const facilities = await switchBu(cookieHeader, facilitiesBuId, "Davors Facilities");

  console.log(
    JSON.stringify(
      {
        production_url: PRODUCTION_URL,
        facilities_bu_lookup: { id: facilitiesBuId, name: "Davors Facilities (matched by name)" },
        enterprise_switch_test: enterprise,
        facilities_switch_test: facilities,
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
