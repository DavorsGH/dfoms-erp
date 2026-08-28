/**
 * Probe maintenance_requests reported_by CHECK + FM test account on staging.
 * Usage: npx tsx scripts/_probe-fm-reported-by-check-staging.ts
 */
import { connectPg } from "./lib/pg-connect";

async function main() {
  const { client, envFile, candidateIndex } = await connectPg({
    envFiles: [".env.staging.local"],
  });
  console.log(`Connected via ${envFile} (candidate ${candidateIndex})`);

  try {
    const { rows: checks } = await client.query(`
      SELECT conname, pg_get_constraintdef(oid) AS def
      FROM pg_constraint
      WHERE conrelid = 'public.maintenance_requests'::regclass
        AND contype = 'c'
      ORDER BY conname
    `);
    console.log("maintenance_requests CHECKs:", JSON.stringify(checks, null, 2));

    const { rows: fm } = await client.query(`
      SELECT facility_manager_id, full_name, email, status, auth_user_id,
        can_manage_maintenance, can_manage_complaints, can_manage_inspections,
        can_log_services, can_collect_rent, can_collect_charges
      FROM public.facility_managers
      WHERE email ILIKE 'david.avors+fm@gmail.com'
    `);
    console.log("FM account:", JSON.stringify(fm, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
