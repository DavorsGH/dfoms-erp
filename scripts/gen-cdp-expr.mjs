import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const scriptName = process.argv[2];
if (!scriptName) {
  throw new Error("Usage: node scripts/gen-cdp-expr.mjs <sql-file>");
}

const sql = readFileSync(resolve(process.cwd(), scriptName), "utf8");
const expression = `(() => {
  const editors = window.monaco?.editor?.getEditors?.();
  if (!editors?.length) {
    return "no editor";
  }
  editors[0].setValue(${JSON.stringify(sql)});
  return "set " + editors[0].getValue().length;
})()`;

writeFileSync(
  resolve(process.cwd(), "scripts/_cdp-expr.json"),
  JSON.stringify({
    method: "Runtime.evaluate",
    params: { expression, returnByValue: true },
  }),
);

console.log("Wrote scripts/_cdp-expr.json");
