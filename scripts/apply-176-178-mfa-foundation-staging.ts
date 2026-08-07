/**
 * Apply MFA foundation scripts 176–178 to staging.
 * Usage: npx tsx scripts/apply-176-178-mfa-foundation-staging.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { connectPg } from "./lib/pg-connect";

const SCRIPTS = [
  "176_user_mfa_settings.sql",
  "177_login_sms_otp_challenges.sql",
  "178_login_mfa_sessions.sql",
] as const;

async function main() {
  const { client, envFile, candidateIndex } = await connectPg({
    envFiles: [".env.staging.local"],
    requiredProjectRef: "wieflwbfdmjtsdnwbfii",
  });
  console.log(`Connected via ${envFile} (candidate ${candidateIndex})`);

  try {
    for (const scriptName of SCRIPTS) {
      const sql = readFileSync(
        resolve(process.cwd(), "scripts", scriptName),
        "utf8",
      );
      await client.query(sql);
      console.log(`OK: applied scripts/${scriptName}`);
    }

    for (const table of [
      "user_mfa_settings",
      "login_sms_otp_challenges",
      "login_mfa_sessions",
    ]) {
      const { rows } = await client.query(
        "SELECT to_regclass($1) AS tbl",
        [`public.${table}`],
      );
      console.log(`Table ${table}:`, rows[0]?.tbl ?? "(missing)");
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
