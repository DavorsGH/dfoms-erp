/**
 * Unit tests for bulk import date column parsing.
 * Usage: npx tsx scripts/test-bulk-import-date-column-unit.ts
 */
import {
  buildBulkImportDateColumnProfiles,
  excelSerialToIsoDate,
  inferBulkImportDateColumnMode,
  isBulkImportExcelEmptyDatePlaceholder,
  parseBulkImportDateWithColumnProfile,
} from "../lib/bulk-import/bulk-import-date-column";
import { assert } from "./lib/env";

function testMdySlashDate() {
  const mode = inferBulkImportDateColumnMode(["1/15/2026"]);
  assert(mode.kind === "mdy", "1/15/2026 should infer MDY column");
  const parsed = parseBulkImportDateWithColumnProfile("1/15/2026", {
    fieldKey: "expiration_date",
    mode,
  });
  assert(parsed.kind === "iso", "1/15/2026 should parse");
  if (parsed.kind === "iso") {
    assert(parsed.iso === "2026-01-15", `expected 2026-01-15 got ${parsed.iso}`);
  }
}

function testDmySlashDate() {
  const mode = inferBulkImportDateColumnMode(["15/01/2026"]);
  assert(mode.kind === "dmy", "15/01/2026 should infer DMY column");
  const parsed = parseBulkImportDateWithColumnProfile("15/01/2026", {
    fieldKey: "date",
    mode,
  });
  assert(parsed.kind === "iso", "15/01/2026 should parse");
  if (parsed.kind === "iso") {
    assert(parsed.iso === "2026-01-15", `expected 2026-01-15 got ${parsed.iso}`);
  }
}

function testAmbiguousDmyDefaultWithWarning() {
  const mode = inferBulkImportDateColumnMode(["03/04/2026"]);
  assert(
    mode.kind === "dmy" && mode.ambiguousDefault === true,
    "03/04/2026 column should default to DMY",
  );
  const parsed = parseBulkImportDateWithColumnProfile("03/04/2026", {
    fieldKey: "expiration_date",
    mode,
  });
  assert(parsed.kind === "ambiguous", "ambiguous slash date should warn");
  if (parsed.kind === "ambiguous") {
    assert(parsed.iso === "2026-04-03", `expected 3 Apr 2026 got ${parsed.iso}`);
  }
}

function testIsoDate() {
  const parsed = parseBulkImportDateWithColumnProfile("2026-01-15", undefined);
  assert(parsed.kind === "iso", "ISO date should parse");
  if (parsed.kind === "iso") {
    assert(parsed.iso === "2026-01-15", "ISO unchanged");
  }
}

function testExcelSerial() {
  const iso = excelSerialToIsoDate(46037);
  assert(iso === "2026-01-15", `serial 46037 expected 2026-01-15 got ${iso}`);
  const parsed = parseBulkImportDateWithColumnProfile(46037, undefined);
  assert(parsed.kind === "iso", "numeric serial should parse");
  if (parsed.kind === "iso") {
    assert(parsed.iso === "2026-01-15", "serial via profile");
  }
}

function testEmptyPlaceholderBlank() {
  assert(
    isBulkImportExcelEmptyDatePlaceholder("1/1/1900"),
    "1/1/1900 is placeholder",
  );
  const parsed = parseBulkImportDateWithColumnProfile("1/1/1900", undefined, {
    required: false,
  });
  assert(parsed.kind === "blank", "placeholder optional → blank");
  const required = parseBulkImportDateWithColumnProfile("1/1/1900", undefined, {
    required: true,
  });
  assert(required.kind === "invalid", "placeholder required → invalid");
}

function testMixedConflictingColumn() {
  const rows = [
    { expiration_date: "1/15/2026" },
    { expiration_date: "15/1/2026" },
    { expiration_date: "3/4/2026" },
  ];
  const profiles = buildBulkImportDateColumnProfiles(rows, ["expiration_date"]);
  const profile = profiles.get("expiration_date");
  assert(profile?.mode.kind === "conflict", "column should be conflict mode");

  const row1 = parseBulkImportDateWithColumnProfile("1/15/2026", profile);
  assert(row1.kind === "iso", "unambiguous MDY row ok in conflict column");

  const row3 = parseBulkImportDateWithColumnProfile("3/4/2026", profile);
  assert(row3.kind === "column_conflict", "ambiguous row should error in conflict column");
}

function main() {
  testMdySlashDate();
  testDmySlashDate();
  testAmbiguousDmyDefaultWithWarning();
  testIsoDate();
  testExcelSerial();
  testEmptyPlaceholderBlank();
  testMixedConflictingColumn();
  console.log("OK: bulk import date column unit tests passed");
}

main();
