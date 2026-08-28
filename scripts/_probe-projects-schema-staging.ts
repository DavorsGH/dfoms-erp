import { connectPg } from "./lib/pg-connect";

async function main() {
  const { client } = await connectPg({
    requiredProjectRef: "wieflwbfdmjtsdnwbfii",
    envFiles: [".env.staging.local"],
  });
  const cols = await client.query(`
    SELECT column_name, data_type, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'projects'
    ORDER BY ordinal_position
  `);
  console.log("projects columns:", cols.rows);
  const fks = await client.query(`
    SELECT conname, pg_get_constraintdef(oid) AS def
    FROM pg_constraint
    WHERE confrelid = 'public.projects'::regclass
    ORDER BY conname
  `);
  console.log("FKs referencing projects:", fks.rows);
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
