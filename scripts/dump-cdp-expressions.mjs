import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

for (let index = 0; index < 3; index += 1) {
  const payload = JSON.parse(
    readFileSync(resolve(process.cwd(), `scripts/_cdp-chunk-${index}.json`), "utf8"),
  );
  writeFileSync(
    resolve(process.cwd(), `scripts/_expr${index}-only.txt`),
    payload.params.expression,
  );
}
