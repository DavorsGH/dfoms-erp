import { resolve } from "node:path";
import { loadEnvForce } from "./lib/env";
import { connectPg } from "./lib/pg-connect";

const PRODUCTION_REF = "tvcurcnmasnocwdxzgvz";
const DIRECTOR_EMAIL = "giftyavors@gmail.com";

async function countsAs(pg: import("pg").Client, authUid: string) {
  await pg.query("BEGIN");
  try {
    await pg.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [authUid]);
    await pg.query("SET LOCAL ROLE authenticated");
    const history = await pg.query("SELECT count(*)::bigint AS count FROM roster_history");
    const config = await pg.query("SELECT count(*)::bigint AS count FROM roster_config");
    return {
      roster_history: Number(history.rows[0]?.count ?? 0),
      roster_config: Number(config.rows[0]?.count ?? 0),
    };
  } finally {
    await pg.query("ROLLBACK");
  }
}

async function main() {
  loadEnvForce(resolve(process.cwd(), ".env.local.backup"));
  const { client: pg, envFile, candidateIndex } = await connectPg({
    envFiles: [".env.local.backup"],
    requiredProjectRef: PRODUCTION_REF,
  });
  console.log("Connected via", envFile, "candidate", candidateIndex);

  try {
    const director = await pg.query(
      `SELECT auth_uid, role, email FROM user_accounts
       WHERE lower(email) = lower($1) AND role = 'director' AND is_active IS NOT DISTINCT FROM true
       LIMIT 1`,
      [DIRECTOR_EMAIL],
    );
    const superAdmin = await pg.query(
      `SELECT auth_uid, role, email FROM user_accounts
       WHERE role = 'super_admin' AND is_active IS NOT DISTINCT FROM true
       ORDER BY CASE WHEN lower(email) = lower($1) THEN 0 ELSE 1 END, email
       LIMIT 1`,
      [DIRECTOR_EMAIL],
    );

    for (const label of ["director", "super_admin"] as const) {
      const row = label === "director" ? director.rows[0] : superAdmin.rows[0];
      if (!row) {
        console.log(JSON.stringify({ role: label, error: "user not found" }));
        continue;
      }
      const counts = await countsAs(pg, String(row.auth_uid));
      console.log(
        JSON.stringify({
          role: label,
          email: row.email,
          auth_uid: row.auth_uid,
          ...counts,
        }),
      );
    }
  } finally {
    await pg.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
