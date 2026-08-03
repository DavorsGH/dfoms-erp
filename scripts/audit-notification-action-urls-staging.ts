/**
 * Read-only audit of notification action_url patterns on staging.
 * Usage: npx tsx scripts/audit-notification-action-urls-staging.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type NotificationTable =
  | "employee_notifications"
  | "landlord_notifications"
  | "lessee_notifications";

type NotificationSampleRow = {
  id: string;
  title: string | null;
  action_url: string | null;
  body: string | null;
  created_at: string | null;
};

type NotificationLandlordMatchRow = {
  id: string;
  action_url: string | null;
  body: string | null;
};

function loadEnvForce(filePath: string) {
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i === -1) continue;
    let value = trimmed.slice(i + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[trimmed.slice(0, i).trim()] = value;
  }
}

async function sample(admin: SupabaseClient, table: NotificationTable) {
  const { data, error } = await admin
    .from(table)
    .select("id, title, action_url, body, created_at")
    .not("action_url", "is", null)
    .order("created_at", { ascending: false })
    .limit(15);
  if (error) {
    console.log(`${table}: ERROR ${error.message}`);
    return;
  }
  const rows = (data ?? []) as NotificationSampleRow[];
  console.log(`\n=== ${table} (latest with action_url, up to 15) ===`);
  for (const row of rows) {
    console.log(
      `- ${row.created_at?.slice(0, 19)} | ${String(row.action_url)} | ${String(row.title).slice(0, 40)}`,
    );
  }

  const { data: landlordish } = await admin
    .from(table)
    .select("id, action_url, body")
    .or(
      "action_url.ilike.%/dashboard/real-estate/landlords%,body.ilike.%/dashboard/real-estate/landlords%",
    )
    .limit(20);
  const landlordRows = (landlordish ?? []) as NotificationLandlordMatchRow[];
  console.log(
    `${table} landlords-path matches:`,
    landlordRows.map((r) => ({
      id: r.id,
      action_url: r.action_url,
      bodyTail: String(r.body ?? "").slice(-120),
    })),
  );
}

async function main() {
  for (const envFile of [".env.staging.local", ".env.local", ".env"]) {
    try {
      loadEnvForce(resolve(process.cwd(), envFile));
    } catch {
      // optional
    }
  }
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  await sample(admin, "employee_notifications");
  await sample(admin, "landlord_notifications");
  await sample(admin, "lessee_notifications");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
