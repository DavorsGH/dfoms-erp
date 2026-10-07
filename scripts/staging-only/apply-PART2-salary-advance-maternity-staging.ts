import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { connectPg } from "../lib/pg-connect";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const CAANTA_TENANT = "61e8e5d9-9cdb-4b8d-9e44-ed0acc23d87b";

const MIGRATIONS = [
  "scripts/372_salary_advance_register.sql",
  "scripts/373_salary_advance_mutations.sql",
  "scripts/374_salary_advance_payroll_lock.sql",
] as const;

async function main() {
  const { client, envFile } = await connectPg({
    requiredProjectRef: STAGING_REF,
    envFiles: [".env.staging.local", ".env.local"],
  });
  console.log(`Connected via ${envFile} (staging ${STAGING_REF})`);
  console.log(`Target test tenant (Caanta): ${CAANTA_TENANT}`);

  for (const file of MIGRATIONS) {
    const sql = readFileSync(resolve(process.cwd(), file), "utf8");
    console.log(`Applying ${file} …`);
    await client.query(sql);
  }

  const check = await client.query<{ reg: string | null }>(
    `SELECT to_regclass('public.salary_advance_register')::text AS reg`,
  );
  if (!check.rows[0]?.reg) {
    throw new Error("salary_advance_register missing after apply");
  }

  console.log("PART 2 migrations 372 → 373 → 374 applied on staging.");
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
