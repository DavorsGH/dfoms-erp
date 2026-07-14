import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const b64 = readFileSync(resolve(process.cwd(), "scripts/.b64-47.txt"), "utf8");
const expr = `(() => { const sql = atob(${JSON.stringify(b64)}); const editors = window.monaco?.editor?.getEditors?.() || []; if (!editors.length) return "no editor"; editors[0].getModel().setValue(sql); return "loaded " + sql.length; })()`;
writeFileSync(resolve(process.cwd(), "scripts/.cdp-expr-47.js"), expr);
console.log("expr length:", expr.length);
