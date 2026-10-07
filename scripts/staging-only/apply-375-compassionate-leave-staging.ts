import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { connectPg } from "../lib/pg-connect";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";

async function main() {
  const { client, envFile } = await connectPg({
    requiredProjectRef: STAGING_REF,
    envFiles: [".env.staging.local", ".env.local"],
  });
  console.log(`Connected via ${envFile}`);
  const sql = readFileSync(
    resolve(process.cwd(), "scripts/375_compassionate_leave_types.sql"),
    "utf8",
  );
  await client.query(sql);
  console.log("375 applied on staging.");
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
