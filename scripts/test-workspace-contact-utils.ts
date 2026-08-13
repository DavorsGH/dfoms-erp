/**
 * Unit tests: signup workspace contact persistence helpers.
 * Usage: npx tsx scripts/test-workspace-contact-utils.ts
 */
import {
  buildSignupWorkspaceContactPatch,
  resolveWorkspaceContactEmail,
  resolveWorkspaceContactPhone,
} from "../utils/workspace-contact-utils";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

console.log("=== Workspace contact utils ===\n");

assert(
  resolveWorkspaceContactEmail("  admin@test.com  ") === "admin@test.com",
  "email trim",
);
assert(resolveWorkspaceContactEmail("") === null, "empty email");
assert(
  resolveWorkspaceContactPhone({ phone: "0241234567", momo_number: null }) ===
    "0241234567",
  "phone primary",
);
assert(
  resolveWorkspaceContactPhone({ phone: "", momo_number: "0559876543" }) ===
    "0559876543",
  "momo fallback",
);
assert(
  resolveWorkspaceContactPhone({ phone: null, momo_number: null }) === null,
  "no phone",
);

const patch = buildSignupWorkspaceContactPatch("owner@example.com", {
  phone: null,
  momo_number: "0240000000",
});
assert(patch.email === "owner@example.com", "patch email");
assert(patch.phone === "0240000000", "patch phone");

console.log("ALL PASS");
