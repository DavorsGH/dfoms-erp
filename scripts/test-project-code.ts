/**
 * Unit test: auto project codes are PRJnn / PRJnnn, never DF-PRJ-xxxx.
 * Usage: npx tsx scripts/test-project-code.ts
 */
import assert from "node:assert/strict";
import {
  PROJECT_CODE_ENTITY_TYPE,
  PROJECT_CODE_PADDING,
  isAutoProjectCode,
  projectCodeShapeError,
} from "../lib/project-code";

assert.equal(PROJECT_CODE_ENTITY_TYPE, "PRJ");
assert.equal(PROJECT_CODE_PADDING, 2);

assert.equal(isAutoProjectCode("PRJ13"), true);
assert.equal(isAutoProjectCode("PRJ01"), true);
assert.equal(isAutoProjectCode("PRJ100"), true);
assert.equal(isAutoProjectCode(" PRJ100 "), true);

assert.equal(isAutoProjectCode("DF-PRJ-0001"), false);
assert.equal(isAutoProjectCode("DF-PRJ-0013"), false);
assert.equal(isAutoProjectCode("PROJ0001"), false);
assert.equal(isAutoProjectCode("PRJ1"), false);
assert.equal(isAutoProjectCode("PRJ"), false);
assert.equal(isAutoProjectCode(""), false);

assert.equal(projectCodeShapeError("PRJ13"), null);
assert.equal(projectCodeShapeError("PRJ100"), null);
assert.match(
  projectCodeShapeError("DF-PRJ-0001") ?? "",
  /not a PRJ code/,
);

console.log("test-project-code: ok");
