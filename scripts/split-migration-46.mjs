import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const sql = readFileSync(
  resolve(process.cwd(), "scripts/46_cascade_delete_and_purchase_rpcs.sql"),
  "utf8",
);

const marker = "-- 5. Cascade delete preview";
const idx = sql.indexOf(marker);
const reload = "NOTIFY pgrst, 'reload schema';";

const part1 = [
  "BEGIN;",
  sql.slice(sql.indexOf("ALTER TABLE"), idx).trim(),
  "COMMIT;",
  reload,
  "",
].join("\n");

const part2 = [
  "BEGIN;",
  sql.slice(idx).replace(/^COMMIT;\s*/m, "").replace(reload, "").trim(),
  "COMMIT;",
  reload,
  "",
].join("\n");

writeFileSync(resolve(process.cwd(), "scripts/46a_purchase_rpcs.sql"), part1);
writeFileSync(resolve(process.cwd(), "scripts/46b_cascade_delete_rpcs.sql"), part2);
console.log("part1", part1.length, "part2", part2.length);
