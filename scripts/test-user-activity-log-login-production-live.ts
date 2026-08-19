/**
 * Verify user_activity_log writes on production via logAuthActivity (same path as login).
 *
 * Usage:
 *   npx tsx scripts/test-user-activity-log-login-production-live.ts --allow-production
 */
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { logUserActivity } from "../utils/user-activity-log-write";
import { loadEnvForce } from "./lib/env";
import { resolve } from "node:path";

const PRODUCTION_REF = "tvcurcnmasnocwdxzgvz";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  if (!process.argv.includes("--allow-production")) {
    throw new Error("Pass --allow-production to run against production.");
  }

  loadEnvForce(resolve(process.cwd(), ".env.local.backup"));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  assert(url && serviceKey, "Missing Supabase env vars");
  assert(url.includes(PRODUCTION_REF), `Refusing non-production URL: ${url}`);

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const marker = `prod-login-live-${randomUUID().slice(0, 8)}`;
  const email = `${marker}@example.com`;

  await logUserActivity(
    {
      persona: "staff",
      tenantId: "00000001-0000-4000-8000-000000000001",
      email,
      eventName: "login.password_failure",
      status: "failure",
      ip: "127.0.0.1",
      metadata: { method: "password", marker, probe: "production-live" },
    },
    admin,
  );

  const { data, error } = await admin
    .from("user_activity_log")
    .select("id, persona, tenant_id, email, event_name, status, metadata, created_at")
    .contains("metadata", { marker })
    .maybeSingle();

  assert(!error, error?.message ?? "select failed");
  assert(data, `No row found for marker ${marker}`);
  console.log("PASS production login log write:", {
    id: data.id,
    event_name: data.event_name,
    status: data.status,
    tenant_id: data.tenant_id,
  });

  await admin.from("user_activity_log").delete().eq("id", data.id);
  console.log("OK: cleaned up probe row");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
