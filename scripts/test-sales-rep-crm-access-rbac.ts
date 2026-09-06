/**
 * Staging verification for sales_rep scoped CRM access (app-layer RBAC only).
 * Run: npx tsx scripts/test-sales-rep-crm-access-rbac.ts
 */
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  CRM_FULL_FEATURE_ROLES,
  CRM_QUOTATIONS_EDIT_ROLES,
  CRM_SECTION_ROLES,
  CRM_SALES_REP_NAV_HREFS,
  INVENTORY_SECTION_ROLES,
  POS_SECTION_ROLES,
  canAccessCrmSection,
  canAccessInventorySection,
  canAccessPosSection,
  getAccessibleReportCategoryIds,
  getSidebarNavItems,
  isCrmNavItemVisibleForRole,
  isCrmPathAllowedForSalesRep,
  isCrmSalesRepScopedRole,
} from "../utils/rbac-access";
import { productSaleChannelFromInvoice } from "../app/dashboard/crm/sales/sales-utils";

function expect(condition: boolean, message: string) {
  assert.ok(condition, message);
}

expect(CRM_SECTION_ROLES.includes("sales_rep"), "sales_rep in CRM_SECTION_ROLES");
expect(
  !CRM_FULL_FEATURE_ROLES.includes("sales_rep"),
  "sales_rep excluded from CRM_FULL_FEATURE_ROLES",
);
expect(
  CRM_QUOTATIONS_EDIT_ROLES.includes("sales_rep"),
  "sales_rep retains quotations API roles",
);
expect(canAccessInventorySection("sales_rep"), "inventory unchanged");
expect(canAccessPosSection("sales_rep"), "POS unchanged");
expect(canAccessCrmSection("sales_rep"), "CRM section access for sidebar");

const sidebar = getSidebarNavItems("sales_rep");
const salesCrmItem = sidebar.find((item) => item.label === "Sales & CRM");
expect(Boolean(salesCrmItem), "sidebar shows Sales & CRM");
expect(
  salesCrmItem?.href === "/dashboard/crm/customers",
  "sales_rep Sales & CRM link goes directly to Customer List (not bare /dashboard/crm)",
);
expect(
  !sidebar.some((item) => item.label === "POS" && item.href === "/dashboard/pos"),
  "no standalone POS sidebar link",
);
expect(
  !getAccessibleReportCategoryIds("sales_rep").includes("sales"),
  "sales reports still hidden",
);

const allowedPaths = [
  "/dashboard/crm",
  "/dashboard/crm/customers",
  "/dashboard/crm/customers/abc",
  "/dashboard/crm/product-sales",
  "/dashboard/crm/sales",
];
for (const path of allowedPaths) {
  expect(isCrmPathAllowedForSalesRep(path), `allowed prefix list: ${path}`);
}

const blockedPaths = [
  "/dashboard/crm/services",
  "/dashboard/crm/discounts",
  "/dashboard/crm/sales-pipeline",
  "/dashboard/crm/sales-targets",
  "/dashboard/crm/commissions",
  "/dashboard/crm/email-promotions/templates",
];
for (const path of blockedPaths) {
  expect(!isCrmPathAllowedForSalesRep(path), `blocked prefix list: ${path}`);
}

for (const href of CRM_SALES_REP_NAV_HREFS) {
  expect(
    isCrmNavItemVisibleForRole(href, "sales_rep"),
    `nav visible: ${href}`,
  );
}
expect(
  !isCrmNavItemVisibleForRole("/dashboard/crm/services", "sales_rep"),
  "services tab hidden",
);

/** Regression: layout guard must not depend on x-pathname (often empty on RSC fetches). */
expect(
  !isCrmPathAllowedForSalesRep(""),
  "legacy pathname guard would block empty x-pathname",
);
expect(
  isCrmSalesRepScopedRole("sales_rep"),
  "sales_rep is scoped role",
);
expect(
  CRM_SECTION_ROLES.includes("sales_rep"),
  "current CRM layout allows sales_rep without pathname header",
);

expect(productSaleChannelFromInvoice("POS-2026-001") === "pos", "POS invoice prefix");
expect(productSaleChannelFromInvoice("PSI-2026-001") === "psi", "PSI invoice prefix");

const crmRoot = join(process.cwd(), "app/dashboard/crm");
const restrictedSegments = [
  "products",
  "services",
  "discounts",
  "sales-pipeline",
  "offline-sale-conflicts",
  "sales-targets",
  "sales-forecast",
  "commission-rules",
  "commissions",
  "loyalty-settings",
  "email-promotions",
];

for (const segment of restrictedSegments) {
  const layoutPath = join(crmRoot, segment, "layout.tsx");
  expect(statSync(layoutPath).isFile(), `restricted layout exists: ${segment}`);
  const contents = readFileSync(layoutPath, "utf8");
  expect(
    contents.includes("guardCrmFullFeatureAccess"),
    `restricted layout guards sales_rep: ${segment}`,
  );
}

const allowedSegments = ["customers", "product-sales", "sales"];
for (const segment of allowedSegments) {
  const layoutPath = join(crmRoot, segment, "layout.tsx");
  let hasNestedLayout = false;
  try {
    hasNestedLayout = statSync(layoutPath).isFile();
  } catch {
    hasNestedLayout = false;
  }
  expect(!hasNestedLayout, `allowed segment has no full-feature-only layout: ${segment}`);
}

const salesCrmLayout = join(process.cwd(), "app/dashboard/sales-crm/layout.tsx");
expect(statSync(salesCrmLayout).isFile(), "sales-crm layout exists for quotations");
expect(
  readFileSync(salesCrmLayout, "utf8").includes("CRM_QUOTATIONS_EDIT_ROLES"),
  "quotations layout allows sales_rep via CRM_QUOTATIONS_EDIT_ROLES",
);

console.log("PASS sales_rep scoped CRM RBAC checks (incl. navigation regression guards)");
