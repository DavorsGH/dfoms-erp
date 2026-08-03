/**
 * Local unit checks for inbox click-through helpers (no network).
 * Usage: npx tsx scripts/test-notification-href-helpers.ts
 */
import {
  displayNotificationBody,
  resolveNotificationHref,
  toNotificationAppPath,
} from "../utils/employee-notifications-types";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const structured = {
  action_url: "/dashboard/real-estate/landlords?highlight=abc",
  body: "Pending approval.\nType: Davors managed",
};
assert(
  resolveNotificationHref(structured) ===
    "/dashboard/real-estate/landlords?highlight=abc",
  "structured action_url",
);
assert(
  !displayNotificationBody(structured).includes("http"),
  "structured body has no URL",
);

const legacyAbsolute = {
  action_url: null,
  body: "Repair submitted.\nhttp://localhost:3000/dashboard/real-estate/maintenance?landlord=x",
};
assert(
  resolveNotificationHref(legacyAbsolute) ===
    "/dashboard/real-estate/maintenance?landlord=x",
  "legacy absolute URL",
);
assert(
  !displayNotificationBody(legacyAbsolute).includes("http"),
  "legacy absolute stripped from display",
);
assert(
  displayNotificationBody(legacyAbsolute).includes("Repair submitted"),
  "legacy body text kept",
);

const legacyRelative = {
  action_url: null,
  body: "Complaint.\n/dashboard/real-estate/complaints?landlord=y",
};
assert(
  resolveNotificationHref(legacyRelative) ===
    "/dashboard/real-estate/complaints?landlord=y",
  "legacy relative path",
);

const announcement = {
  action_url: null,
  body: "Please submit timesheets by Friday.",
};
assert(resolveNotificationHref(announcement) === null, "announcement no href");
assert(
  displayNotificationBody(announcement) === announcement.body,
  "announcement body unchanged",
);

assert(
  toNotificationAppPath("https://portal.example.com/dashboard/foo?a=1#x") ===
    "/dashboard/foo?a=1#x",
  "absolute to path",
);

const staleLandlordDetail = {
  action_url: "/dashboard/real-estate/landlords/11111111-2222-3333-4444-555555555555",
  body: "Pending approval",
};
assert(
  resolveNotificationHref(staleLandlordDetail) ===
    "/dashboard/real-estate/landlords?highlight=11111111-2222-3333-4444-555555555555",
  "stale landlord detail path rewritten",
);

console.log("PASS notification href/display helpers");
