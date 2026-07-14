import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const sql = readFileSync(
  resolve(process.cwd(), "scripts/38_sales_inventory_foundation.sql"),
  "utf8",
);

const maxChunkSize = 3500;
const lines = sql.split("\n");
const chunks = [];
let current = "";

for (const line of lines) {
  const next = current ? `${current}\n${line}` : line;
  if (next.length > maxChunkSize && current) {
    chunks.push(current);
    current = line;
  } else {
    current = next;
  }
}

if (current) {
  chunks.push(current);
}

chunks.forEach((chunk, index) => {
  const expression =
    index === 0
      ? `(() => {
  const editors = window.monaco?.editor?.getEditors?.();
  if (!editors?.length) return "no editor";
  editors[0].setValue(${JSON.stringify(chunk)});
  return "chunk ${index} len " + editors[0].getValue().length;
})()`
      : `(() => {
  const editors = window.monaco?.editor?.getEditors?.();
  if (!editors?.length) return "no editor";
  editors[0].setValue(editors[0].getValue() + ${JSON.stringify(chunk)});
  return "chunk ${index} len " + editors[0].getValue().length;
})()`;

  writeFileSync(
    resolve(process.cwd(), `scripts/_cdp-chunk-${index}.json`),
    JSON.stringify({
      method: "Runtime.evaluate",
      params: { expression, returnByValue: true },
    }),
  );
});

console.log(`Wrote ${chunks.length} CDP chunk file(s). Total SQL length: ${sql.length}`);
