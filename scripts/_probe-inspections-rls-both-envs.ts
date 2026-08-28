/**
 * READ-ONLY probe: public.inspections RLS / grants / row count
 * on staging + production. Does not modify data.
 */
import { connectPg } from "./lib/pg-connect";

type EnvSpec = {
  label: string;
  requiredProjectRef: string;
  envFiles: string[];
  alsoFacilityManagersCols?: boolean;
};

const ENVS: EnvSpec[] = [
  {
    label: "STAGING",
    requiredProjectRef: "wieflwbfdmjtsdnwbfii",
    envFiles: [".env.staging.local"],
    alsoFacilityManagersCols: true,
  },
  {
    label: "PRODUCTION",
    requiredProjectRef: "tvcurcnmasnocwdxzgvz",
    envFiles: [".env.local.backup", ".env.local"],
  },
];

async function probe(env: EnvSpec) {
  console.log("\n" + "=".repeat(72));
  console.log(`=== ${env.label} (ref ${env.requiredProjectRef}) ===`);
  console.log("=".repeat(72));

  const { client, envFile, candidateIndex } = await connectPg({
    requiredProjectRef: env.requiredProjectRef,
    envFiles: env.envFiles,
  });
  console.log(`Connected via ${envFile} (candidate #${candidateIndex})`);

  try {
    // 1) Table exists?
    const exists = await client.query<{ exists: boolean }>(`
      SELECT EXISTS (
        SELECT 1
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname = 'inspections'
          AND c.relkind = 'r'
      ) AS exists
    `);
    console.log("\n[1] Table public.inspections exists?", exists.rows[0]?.exists);

    if (!exists.rows[0]?.exists) {
      console.log("Table missing — skipping remaining inspections queries.");
    } else {
      // 2) RLS flags
      const rls = await client.query(`
        SELECT c.relrowsecurity, c.relforcerowsecurity
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = 'inspections'
      `);
      console.log("\n[2] RLS flags (relrowsecurity, relforcerowsecurity):");
      console.log(JSON.stringify(rls.rows, null, 2));

      // 3) Policies
      const policies = await client.query(`
        SELECT
          pol.polname,
          CASE pol.polcmd
            WHEN 'r' THEN 'SELECT'
            WHEN 'a' THEN 'INSERT'
            WHEN 'w' THEN 'UPDATE'
            WHEN 'd' THEN 'DELETE'
            WHEN '*' THEN 'ALL'
            ELSE pol.polcmd::text
          END AS cmd,
          COALESCE(
            (
              SELECT array_agg(pg_get_userbyid(r)::text ORDER BY pg_get_userbyid(r)::text)
              FROM unnest(pol.polroles) AS r
            ),
            ARRAY['public']::text[]
          ) AS roles,
          pg_get_expr(pol.polqual, pol.polrelid) AS qual,
          pg_get_expr(pol.polwithcheck, pol.polrelid) AS with_check
        FROM pg_policy pol
        JOIN pg_class c ON c.oid = pol.polrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = 'inspections'
        ORDER BY pol.polname
      `);
      // Also via pg_policies for clarity
      const policiesView = await client.query(`
        SELECT policyname AS polname, cmd, roles, qual, with_check
        FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'inspections'
        ORDER BY policyname
      `);
      console.log("\n[3] Policies on public.inspections (from pg_policies):");
      if (policiesView.rows.length === 0) {
        console.log("(none)");
      } else {
        for (const row of policiesView.rows) {
          console.log("---");
          console.log(JSON.stringify(row, null, 2));
        }
      }
      // silence unused if we keep both
      void policies;

      // 4) Grants
      const grants = await client.query(`
        SELECT grantee, privilege_type, is_grantable
        FROM information_schema.role_table_grants
        WHERE table_schema = 'public'
          AND table_name = 'inspections'
          AND grantee IN ('authenticated', 'anon', 'public', 'service_role', 'PUBLIC')
        ORDER BY grantee, privilege_type
      `);
      console.log("\n[4] GRANTs on public.inspections (authenticated/anon/public/service_role):");
      if (grants.rows.length === 0) {
        console.log("(none from information_schema for those grantees)");
      } else {
        console.log(JSON.stringify(grants.rows, null, 2));
      }

      // Also ACL from pg_catalog for completeness
      const acl = await client.query(`
        SELECT
          c.relacl::text AS relacl,
          (
            SELECT string_agg(format('%s=%s', grantee, privilege_type), ', ' ORDER BY grantee, privilege_type)
            FROM (
              SELECT
                CASE WHEN grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(grantee)::text END AS grantee,
                privilege_type
              FROM aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner)))
            ) x
            WHERE CASE WHEN grantee = 'PUBLIC' THEN 'public' ELSE grantee END
              IN ('authenticated', 'anon', 'public', 'PUBLIC', 'service_role')
               OR grantee IN ('authenticated', 'anon', 'public', 'PUBLIC', 'service_role')
          ) AS filtered
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = 'inspections'
      `);
      console.log("\n[4b] pg_class.relacl (raw) / filtered:");
      console.log(JSON.stringify(acl.rows, null, 2));

      // 5) Row count
      const count = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM public.inspections`,
      );
      console.log("\n[5] Row count public.inspections:", count.rows[0]?.count);

      // 6) Migration 245 policy present?
      const pol245 = await client.query<{ exists: boolean }>(`
        SELECT EXISTS (
          SELECT 1
          FROM pg_policies
          WHERE schemaname = 'public'
            AND tablename = 'inspections'
            AND policyname = 'facility_portal_select_assigned_inspections'
        ) AS exists
      `);
      console.log(
        "\n[6] Policy facility_portal_select_assigned_inspections exists?",
        pol245.rows[0]?.exists,
      );
      console.log(
        "     => migration 245 applied?",
        pol245.rows[0]?.exists ? "YES (policy present)" : "NO (policy absent — 245 NOT applied)",
      );
    }

    if (env.alsoFacilityManagersCols) {
      const cols = await client.query<{ column_name: string; data_type: string }>(`
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'facility_managers'
          AND column_name IN (
            'can_collect_rent',
            'can_collect_charges',
            'can_log_services',
            'can_manage_inspections'
          )
        ORDER BY column_name
      `);
      console.log("\n[QUICK] facility_managers permission columns on STAGING:");
      const wanted = [
        "can_collect_rent",
        "can_collect_charges",
        "can_log_services",
        "can_manage_inspections",
      ];
      for (const name of wanted) {
        const hit = cols.rows.find((r) => r.column_name === name);
        console.log(
          `  ${name}: ${hit ? `YES (${hit.data_type})` : "NO"}`,
        );
      }
    }
  } finally {
    await client.end();
  }
}

async function main() {
  for (const env of ENVS) {
    try {
      await probe(env);
    } catch (err) {
      console.error(`\n!!! ${env.label} FAILED:`, err instanceof Error ? err.message : err);
    }
  }
  console.log("\nDone (read-only).");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
