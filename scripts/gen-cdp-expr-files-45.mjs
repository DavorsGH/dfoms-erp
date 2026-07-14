import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const chunks = JSON.parse(
  readFileSync(resolve(process.cwd(), "scripts/.cdp-b64-chunks-45.json"), "utf8"),
);

for (let index = 0; index < chunks.length; index += 1) {
  const mode = index === 0 ? "set" : "append";
  const expression = `(() => {
    const chunk = atob(${JSON.stringify(chunks[index])});
    const editors = window.monaco?.editor?.getEditors?.() || [];
    if (!editors.length) return "no editor";
    const model = editors[0].getModel();
    const current = ${index === 0 ? '""' : "model.getValue()"};
    const next = ${index === 0 ? "chunk" : "current + chunk"};
    model.setValue(next);
    return "${mode} " + next.length;
  })()`;

  writeFileSync(
    resolve(process.cwd(), `scripts/.cdp-expr-${index}.json`),
    JSON.stringify({ method: "Runtime.evaluate", params: { expression, returnByValue: true } }),
  );
}

console.log("Wrote CDP expression payloads for chunks 0..", chunks.length - 1);
