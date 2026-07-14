import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const sql = readFileSync(
  resolve(process.cwd(), "scripts/45_purchase_edit_delete_and_archive.sql"),
  "utf8",
);

const chunkSize = 3500;
const chunks = [];
for (let index = 0; index < sql.length; index += chunkSize) {
  chunks.push(sql.slice(index, index + chunkSize));
}

writeFileSync(
  resolve(process.cwd(), "scripts/.cdp-chunks-45.json"),
  JSON.stringify(chunks),
);

console.log(`chunks: ${chunks.length}, sizes: ${chunks.map((c) => c.length).join(", ")}`);
