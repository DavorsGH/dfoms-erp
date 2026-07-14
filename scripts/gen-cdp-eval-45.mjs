import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const sql = readFileSync(
  resolve(process.cwd(), "scripts/45_purchase_edit_delete_and_archive.sql"),
  "utf8",
);

const expression = `(() => {
  const sql = ${JSON.stringify(sql)};
  const editors = window.monaco?.editor?.getEditors?.() || [];
  if (!editors.length) return "no editor";
  editors[0].setValue(sql);
  return "set " + sql.length;
})()`;

writeFileSync(resolve(process.cwd(), "scripts/.cdp-eval-45.json"), JSON.stringify({ expression }));
