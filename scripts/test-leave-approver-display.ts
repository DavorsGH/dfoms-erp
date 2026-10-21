/**
 * Leave approver display and the change-approver role gate.
 * Usage: npx tsx scripts/test-leave-approver-display.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { formatLeaveApproverDisplay } from "../app/dashboard/self-service/leave-request-utils";

assert.equal(
  formatLeaveApproverDisplay({
    approverUserAccountId: "ab4fff20-9d89-4265-97e1-87cbb596490a",
    fullName: "David Ikechukwu Mawunyo Avors",
    staffId: "DF0001",
    email: "david.avors@gmail.com",
  }),
  "David Ikechukwu Mawunyo Avors (DF0001)",
);

assert.equal(
  formatLeaveApproverDisplay({
    approverUserAccountId: "ab4fff20-9d89-4265-97e1-87cbb596490a",
  }),
  "Unknown user (ab4fff20…)",
);

assert.equal(
  formatLeaveApproverDisplay({
    approverUserAccountId: "67e20016-8ad6-4234-b2c2-f3a76811c4aa",
    email: "giftyavors@gmail.com",
  }),
  "giftyavors@gmail.com",
);

const route = readFileSync(
  join(process.cwd(), "app/api/leave/change-approver/route.ts"),
  "utf8",
);
assert.equal(route.includes('requireTenantRoleIn(["super_admin"])'), true);
assert.equal(route.includes("PAYMENT_AND_LEAVE_APPROVER_ROLES"), false);

const paymentRoute = readFileSync(
  join(process.cwd(), "app/api/payment-accounts/route.ts"),
  "utf8",
);
assert.equal(
  paymentRoute.includes("PAYMENT_AND_LEAVE_APPROVER_ROLES"),
  true,
);

const settings = readFileSync(
  join(process.cwd(), "app/dashboard/administration/leave-settings.tsx"),
  "utf8",
);
assert.equal(
  settings.includes("Only an administrator can change the leave approver."),
  true,
);
assert.equal(settings.includes("setApproverLoading(false)"), true);

console.log("leave approver display tests passed");
