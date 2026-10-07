import { connectPg } from "../lib/pg-connect";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";

async function main() {
  const { client, envFile } = await connectPg({
    requiredProjectRef: STAGING_REF,
    envFiles: [".env.staging.local"],
  });
  console.log(`Connected via ${envFile}`);
  await client.query(`
    GRANT EXECUTE ON FUNCTION public.update_production_batch(uuid, uuid, date, uuid, numeric, text, jsonb, date, date)
      TO authenticated, service_role;
  `);
  console.log("Granted update_production_batch to authenticated.");
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
