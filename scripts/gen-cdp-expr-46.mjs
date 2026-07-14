import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const sql = readFileSync(
  resolve(process.cwd(), "scripts/46_cascade_delete_and_purchase_rpcs.sql"),
  "utf8",
);

const chunkSize = 3500;
const chunks = [];
for (let index = 0; index < sql.length; index += chunkSize) {
  chunks.push(sql.slice(index, index + chunkSize));
}

const b64 = chunks.map((chunk) => Buffer.from(chunk, "utf8").toString("base64"));
writeFileSync(
  resolve(process.cwd(), "scripts/.cdp-b64-chunks-46.json"),
  JSON.stringify(b64),
);

for (let index = 0; index < b64.length; index += 1) {
  const expression =
    index === 0
      ? `(() => { const chunk = atob(${JSON.stringify(b64[index])}); const editors = window.monaco?.editor?.getEditors?.() || []; if (!editors.length) return "no editor"; editors[0].getModel().setValue(chunk); return "set " + chunk.length; })()`
      : `(() => { const chunk = atob(${JSON.stringify(b64[index])}); const editors = window.monaco?.editor?.getEditors?.() || []; if (!editors.length) return "no editor"; const model = editors[0].getModel(); model.setValue(model.getValue() + chunk); return "append " + model.getValue().length; })()`;

  writeFileSync(
    resolve(process.cwd(), `scripts/.cdp-expr-46-${index}.js`),
    expression,
  );
}

console.log(`chunks: ${chunks.length}`, chunks.map((chunk) => chunk.length).join(","));
