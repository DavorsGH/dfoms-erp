/**
 * Insert platform_billing_config.referral_reward_ghs on staging if missing.
 * Usage: npx tsx scripts/apply-295-referral-reward-ghs-seed-staging.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { connectPg } from "./lib/pg-connect";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";

async function main() {
  const sql = readFileSync(
    resolve(process.cwd(), "scripts/295_referral_reward_ghs_seed.sql"),
    "utf8",
  );

  const { client, envFile, candidateIndex } = await connectPg({
    envFiles: [".env.staging.local", ".env.local"],
    requiredProjectRef: STAGING_REF,
  });
  console.log(`Connected via ${envFile} (candidate ${candidateIndex})`);

  try {
    const { rows: before } = await client.query(
      `SELECT config_key, price_ghs, updated_at
       FROM public.platform_billing_config
       WHERE config_key = 'referral_reward_ghs'`,
    );
    console.log("Before:", before[0] ?? "(no row)");

    await client.query(sql);

    const { rows: after } = await client.query(
      `SELECT config_key, price_ghs, updated_at
       FROM public.platform_billing_config
       WHERE config_key = 'referral_reward_ghs'`,
    );
    console.log("After:", after[0] ?? "(still missing — check failed)");

    if (!after[0]) {
      throw new Error("referral_reward_ghs row still missing after seed apply.");
    }

    console.log("OK: referral_reward_ghs seed applied on staging.");
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
