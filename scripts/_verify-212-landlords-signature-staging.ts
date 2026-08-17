/**
 * Verify landlords.signature_url columns exist and are queryable on staging.
 *
 *   npx tsx scripts/_verify-212-landlords-signature-staging.ts --env-file .env.staging.local
 */
import pg from "pg";
import { createClient } from "@supabase/supabase-js";
import { loadEnvFromArgv } from "./lib/env";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";

async function main() {
  loadEnvFromArgv(process.argv.slice(2));
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  if (!supabaseUrl.includes(STAGING_REF)) {
    throw new Error("Expected staging Supabase URL in env");
  }

  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    throw new Error("DATABASE_URL required");
  }

  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    const { rows } = await client.query(
      `SELECT tenant_id, signature_url, signature_author_name, signature_author_title
       FROM public.landlords
       LIMIT 3`,
    );
    console.log("Direct SQL SELECT ok:", rows);
  } finally {
    await client.end();
  }

  const admin = createClient(
    supabaseUrl,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data, error } = await admin
    .from("landlords")
    .select(
      "notification_phone, logo_url, landlord_type, signature_url, signature_author_name, signature_author_title",
    )
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Supabase SELECT failed: ${error.message}`);
  }
  console.log("Supabase admin SELECT ok:", data);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
