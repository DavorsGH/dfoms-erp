import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const chunks = JSON.parse(
  readFileSync(resolve(process.cwd(), "scripts/.cdp-b64-chunks-46.json"), "utf8"),
);

for (let index = 0; index < chunks.length; index += 1) {
  const expr =
    index === 0
      ? `window.__b64chunks=[${JSON.stringify(chunks[index])}]; 'init ' + window.__b64chunks.length`
      : `window.__b64chunks.push(${JSON.stringify(chunks[index])}); 'push ' + window.__b64chunks.length`;

  writeFileSync(resolve(process.cwd(), `scripts/.cdp-push-${index}.txt`), expr);
}

const final = `(() => { const sql = window.__b64chunks.map(c => atob(c)).join(''); const editors = window.monaco?.editor?.getEditors?.() || []; if (!editors.length) return 'no editor'; editors[0].getModel().setValue(sql); return 'loaded ' + sql.length; })()`;

writeFileSync(resolve(process.cwd(), "scripts/.cdp-final.txt"), final);
console.log(`generated ${chunks.length} push exprs + final`);
