import { resolve } from "node:path";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: resolve(process.cwd(), ".env.staging.local") });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? "";
const email = "david.avors@unifaitechnologies.com";
const password =
  process.env.LANDLORD_TEST_PASSWORD?.trim() || "LandlordStagingTest!2026";

async function main() {
  console.log("host", url ? new URL(url).hostname : "(missing)");
  const client = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.signInWithPassword({
    email,
    password,
  });
  if (error) {
    console.log("AUTH_FAIL", error.message);
    process.exit(1);
  }
  console.log("AUTH_OK", data.user?.id);
}

main();
