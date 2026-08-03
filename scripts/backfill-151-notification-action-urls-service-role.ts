/**
 * Idempotent staging/production backfill via service_role (no DATABASE_URL).
 * Mirrors scripts/151_backfill_notification_action_urls.sql.
 *
 * Usage: npx tsx scripts/backfill-151-notification-action-urls-service-role.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

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

const STALE_ACTION =
  /\/dashboard\/real-estate\/landlords\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i;

const STALE_BODY =
  /(^|\n)((?:https?:\/\/[^\s]+)?\/dashboard\/real-estate\/landlords\/)([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?(\s*)$/i;

function rewriteActionUrl(actionUrl: string): string | null {
  if (/[?&]highlight=/i.test(actionUrl)) return null;
  const match = actionUrl.match(STALE_ACTION);
  if (!match?.[1]) return null;
  return `/dashboard/real-estate/landlords?highlight=${match[1]}`;
}

function rewriteBody(body: string): string | null {
  if (!STALE_BODY.test(body)) return null;
  return body.replace(
    STALE_BODY,
    "$1/dashboard/real-estate/landlords?highlight=$3$4",
  );
}

async function backfillActionUrls(
  admin: SupabaseClient,
  table: "employee_notifications" | "landlord_notifications" | "lessee_notifications",
): Promise<number> {
  const { data, error } = await admin
    .from(table)
    .select("id, action_url")
    .not("action_url", "is", null)
    .ilike("action_url", "%/dashboard/real-estate/landlords/%");

  if (error) {
    throw new Error(`${table} action_url select: ${error.message}`);
  }

  let updated = 0;
  for (const row of data ?? []) {
    const next = rewriteActionUrl(String(row.action_url ?? ""));
    if (!next) continue;
    const { error: updateError } = await admin
      .from(table)
      .update({ action_url: next })
      .eq("id", row.id);
    if (updateError) {
      throw new Error(`${table} update ${row.id}: ${updateError.message}`);
    }
    updated += 1;
  }
  return updated;
}

async function backfillEmployeeBodies(admin: SupabaseClient): Promise<number> {
  const { data, error } = await admin
    .from("employee_notifications")
    .select("id, body")
    .or(
      "body.ilike.%/dashboard/real-estate/landlords/%,body.ilike.%/dashboard/real-estate/landlords?highlight=%",
    );

  if (error) {
    throw new Error(`employee_notifications body select: ${error.message}`);
  }

  let updated = 0;
  for (const row of data ?? []) {
    const next = rewriteBody(String(row.body ?? ""));
    if (!next || next === row.body) continue;
    const { error: updateError } = await admin
      .from("employee_notifications")
      .update({ body: next })
      .eq("id", row.id);
    if (updateError) {
      throw new Error(
        `employee_notifications body update ${row.id}: ${updateError.message}`,
      );
    }
    updated += 1;
  }
  return updated;
}

const HIGHLIGHT_FROM_BODY =
  /\/dashboard\/real-estate\/landlords\?highlight=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\s*$/i;

async function promoteBodyLandlordLinksToActionUrl(
  admin: SupabaseClient,
): Promise<number> {
  const { data, error } = await admin
    .from("employee_notifications")
    .select("id, action_url, body")
    .is("action_url", null)
    .or(
      "body.ilike.%/dashboard/real-estate/landlords/%,body.ilike.%/dashboard/real-estate/landlords?highlight=%",
    );

  if (error) {
    throw new Error(
      `employee_notifications promote select: ${error.message}`,
    );
  }

  let updated = 0;
  for (const row of data ?? []) {
    const body = String(row.body ?? "");
    const highlight = body.match(HIGHLIGHT_FROM_BODY)?.[1];
    const stale = body.match(STALE_ACTION)?.[1];
    const uuid = highlight ?? stale;
    if (!uuid) continue;
    const actionUrl = `/dashboard/real-estate/landlords?highlight=${uuid}`;
    const { error: updateError } = await admin
      .from("employee_notifications")
      .update({ action_url: actionUrl })
      .eq("id", row.id);
    if (updateError) {
      throw new Error(
        `employee_notifications promote ${row.id}: ${updateError.message}`,
      );
    }
    updated += 1;
  }
  return updated;
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
  if (!url || !serviceKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  if (!url.includes("wieflwbfdmjtsdnwbfii")) {
    throw new Error(`Refusing non-staging URL: ${url}`);
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  async function runPass() {
    return {
      "employee_notifications.action_url": await backfillActionUrls(
        admin,
        "employee_notifications",
      ),
      "employee_notifications.body": await backfillEmployeeBodies(admin),
      "employee_notifications.action_url_from_body":
        await promoteBodyLandlordLinksToActionUrl(admin),
      "landlord_notifications.action_url": await backfillActionUrls(
        admin,
        "landlord_notifications",
      ),
      "lessee_notifications.action_url": await backfillActionUrls(
        admin,
        "lessee_notifications",
      ),
    };
  }

  const pass1 = await runPass();
  console.log("Rows updated (pass 1):", pass1);

  const pass2 = await runPass();
  console.log("Rows updated (pass 2, expect all 0):", pass2);

  const nonZeroSecond = Object.values(pass2).some((n) => n !== 0);
  if (nonZeroSecond) {
    throw new Error("Idempotency failed: second pass still updated rows");
  }

  const { count, error: countError } = await admin
    .from("employee_notifications")
    .select("id", { count: "exact", head: true })
    .like("action_url", "/dashboard/real-estate/landlords?highlight=%");
  if (countError) {
    throw new Error(countError.message);
  }
  console.log(
    "PASS: backfill complete. employee highlight= rows:",
    count ?? 0,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
