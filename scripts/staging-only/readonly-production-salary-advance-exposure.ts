/**
 * Read-only: confirm salary_advance_register (372) not on production.
 * npx tsx scripts/staging-only/readonly-production-salary-advance-exposure.ts --env-file .env.local.production-backup-2026-08-25
 */
import { connectPg } from "../lib/pg-connect";

async function main() {
  const envFile =
    process.argv.find((a) => a.startsWith("--env-file="))?.split("=")[1] ??
    ".env.local.production-backup-2026-08-25";

  const { client } = await connectPg({
    envFiles: [envFile],
  });

  const reg = await client.query<{ reg: string | null }>(
    `SELECT to_regclass('public.salary_advance_register')::text AS reg`,
  );
  const tableExists = Boolean(reg.rows[0]?.reg);

  let policies: Array<{ policyname: string; cmd: string }> = [];
  if (tableExists) {
    const pol = await client.query<{ policyname: string; cmd: string }>(
      `SELECT policyname, cmd::text AS cmd
       FROM pg_policies
       WHERE schemaname = 'public' AND tablename = 'salary_advance_register'
       ORDER BY policyname`,
    );
    policies = pol.rows;
  }

  console.log(JSON.stringify({ tableExists, policyCount: policies.length, policies }, null, 2));
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
