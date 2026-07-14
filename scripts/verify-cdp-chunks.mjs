import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const chunk0 = JSON.parse(
  readFileSync(resolve(process.cwd(), "scripts/_cdp-chunk-0.json"), "utf8"),
);
const chunk1 = JSON.parse(
  readFileSync(resolve(process.cwd(), "scripts/_cdp-chunk-1.json"), "utf8"),
);

const expr0 = chunk0.params.expression;
const expr1 = chunk1.params.expression;

const setMatch = expr0.match(/setValue\((.+)\);\n  return/s);
const appendMatch = expr1.match(/getValue\(\) \+ (.+)\);\n  return/s);

if (!setMatch || !appendMatch) {
  throw new Error("Could not parse chunk expressions.");
}

const part0 = JSON.parse(setMatch[1]);
const part1 = JSON.parse(appendMatch[1]);

console.log("Part 0 ends with:", part0.slice(-80));
console.log("Part 1 starts with:", part1.slice(0, 80));
console.log("Joined length:", part0.length + part1.length);
