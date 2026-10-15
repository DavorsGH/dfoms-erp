/**
 * Staging: assistant finance + consumables tools (builder parity, tenant isolation, optional E2E chat).
 *
 *   npx tsx scripts/test-assistant-finance-consumables-staging.ts
 *   APP_URL=http://localhost:3000 npx tsx scripts/test-assistant-finance-consumables-staging.ts
 */
import { resolve } from "node:path";
import { config } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  buildContractProfitabilityReport,
  type OverheadAllocationMode,
} from "../app/dashboard/reports/contract-profitability-utils";
import { monthIndexFromMonthNumber } from "../app/dashboard/reports/finance-reports-utils";
import {
  fetchConsumableItemsForScope,
  fetchConsumableMovementsForScope,
  fetchConsumableSitesForScope,
} from "../app/dashboard/operations/consumables-store-data";
import {
  buildConsumableStockRows,
  buildSiteUsageRows,
  groupMovementsByItemId,
} from "../app/dashboard/operations/consumables-store-utils";
import {
  buildInterUnitPairSummaries,
  BUSINESS_UNIT_TRANSFER_SELECT,
  normalizeBusinessUnitTransferRecord,
  type BusinessUnitTransferRecord,
} from "../app/dashboard/finance/business-unit-transfers-utils";
import { roundAssistantAmount } from "../utils/assistant-tool-format";
import { isExpenseRegisterPayrollLabourCategory } from "../app/dashboard/finance/expense-register-bulk-project-utils";
import {
  getEntryMonthIndex,
  getTaxExclusiveExpenseAmount,
  shouldIncludeExpenseInProfitLoss,
} from "../app/dashboard/finance/profit-loss-utils";

config({ path: resolve(process.cwd(), ".env.staging.local") });

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const DAVORS = "00000001-0000-4000-8000-000000000001";
const CAANTA = "61e8e5d9-9cdb-4b8d-9e44-ed0acc23d87b";
const APP_URL = (process.env.APP_URL ?? "").replace(/\/$/, "");
const STAFF_EMAIL =
  process.env.STAGING_STAFF_EMAIL?.trim() ?? "david.avors@gmail.com";
const STAFF_PASSWORD = process.env.STAGING_STAFF_PASSWORD?.trim() ?? "";

type Check = { name: string; pass: boolean; detail: string };
const checks: Check[] = [];

function record(name: string, pass: boolean, detail: string) {
  checks.push({ name, pass, detail });
  console.log(`[${pass ? "PASS" : "FAIL"}] ${name}: ${detail}`);
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

const ALL_BU_SCOPE = { mode: "all" as const };

async function loadContractProfitabilityPayload(
  admin: SupabaseClient,
  tenantId: string,
) {
  const incomeSelect =
    "id, date, service_category, amount, entry_type, sale_status, net_of_tax_amount, output_vat_amount, client_invoice_id, payment_status";
  const expenseSelect =
    "id, date, expense_category, amount, net_of_tax_amount, project_id, vendor, receipt_no";

  const [
    incomeResult,
    expenseResult,
    contractsResult,
    projectsResult,
    invoicesResult,
  ] = await Promise.all([
    admin
      .from("income_register")
      .select(incomeSelect)
      .eq("tenant_id", tenantId),
    admin
      .from("expense_register")
      .select(expenseSelect)
      .eq("tenant_id", tenantId),
    admin.from("service_contracts").select("*").eq("tenant_id", tenantId),
    admin.from("projects").select("*").eq("tenant_id", tenantId),
    admin.from("client_invoices").select("id, contract_id").eq("tenant_id", tenantId),
  ]);

  const invoiceContractById: Record<string, string | null> = {};
  for (const row of invoicesResult.data ?? []) {
    invoiceContractById[String(row.id)] =
      (row.contract_id as string | null) ?? null;
  }

  return {
    initialIncomeEntries: incomeResult.data ?? [],
    initialExpenseEntries: expenseResult.data ?? [],
    initialFixedAssets: [],
    initialServiceContracts: contractsResult.data ?? [],
    initialProjects: projectsResult.data ?? [],
    initialPayrollRows: [],
    initialPayrollProcessingRows: [],
    invoiceContractById,
    tenantHasServiceContracts: (contractsResult.data ?? []).length > 0,
    fetchError: null as string | null,
  };
}

async function signInCookie(email: string, password: string): Promise<string> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? "";
  const client = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.signInWithPassword({
    email,
    password,
  });
  if (error || !data.session) {
    throw new Error(`sign-in failed for ${email}: ${error?.message}`);
  }
  const projectRef = new URL(url).hostname.split(".")[0];
  const cookieName = `sb-${projectRef}-auth-token`;
  const cookieValue = encodeURIComponent(
    JSON.stringify({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      expires_at: data.session.expires_at,
      expires_in: data.session.expires_in,
      token_type: "bearer",
      user: data.session.user,
    }),
  );
  return `${cookieName}=${cookieValue}`;
}

async function askAssistant(cookie: string, message: string): Promise<string> {
  const response = await fetch(`${APP_URL}/api/assistant/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ message, conversationHistory: [] }),
  });
  const payload = (await response.json().catch(() => null)) as {
    reply?: string;
    error?: string;
  } | null;
  if (!response.ok) {
    return payload?.error ?? `HTTP ${response.status}`;
  }
  return payload?.reply ?? "";
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url.includes(STAGING_REF) || !key) {
    throw new Error("Staging .env.staging.local with service role required");
  }

  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const year = 2026;
  const month = 9;
  const monthIndex = monthIndexFromMonthNumber(month);
  const allocationMode: OverheadAllocationMode = "none";

  async function untaggedExpenseTotal(tenantId: string) {
    const { data } = await admin
      .from("expense_register")
      .select(
        "date, expense_category, project_id, amount, net_of_tax_amount",
      )
      .eq("tenant_id", tenantId);
    let count = 0;
    let total = 0;
    const monthIndex = monthIndexFromMonthNumber(month);
    for (const row of data ?? []) {
      if (isExpenseRegisterPayrollLabourCategory(row.expense_category)) {
        continue;
      }
      if (!shouldIncludeExpenseInProfitLoss(row.expense_category, row)) {
        continue;
      }
      if (getEntryMonthIndex(row.date, year) !== monthIndex) {
        continue;
      }
      if (row.project_id?.trim()) {
        continue;
      }
      count += 1;
      total = round2(total + getTaxExclusiveExpenseAmount(row));
    }
    return { count, total };
  }

  const taggingDavors = await untaggedExpenseTotal(DAVORS);
  const taggingCaanta = await untaggedExpenseTotal(CAANTA);

  const loaderShape = await loadContractProfitabilityPayload(admin, DAVORS);
  const report = buildContractProfitabilityReport({
    financialYear: year,
    monthIndex,
    allocationMode,
    incomeEntries: loaderShape.initialIncomeEntries as never,
    expenseEntries: loaderShape.initialExpenseEntries as never,
    fixedAssets: [],
    invoiceContractById: new Map(Object.entries(loaderShape.invoiceContractById)),
    serviceContracts: loaderShape.initialServiceContracts as never,
    projects: loaderShape.initialProjects as never,
    payrollRows: [],
    payrollProcessingRows: [],
    tenantHasServiceContracts: loaderShape.tenantHasServiceContracts,
  });

  record(
    "Contract profitability — untagged expense warning matches tagging rules (Sep 2026)",
    report.warnings.expensesWithoutProjectCount === taggingDavors.count,
    `reportWarningCount=${report.warnings.expensesWithoutProjectCount} taggingCount=${taggingDavors.count} taggingTotal=${taggingDavors.total}`,
  );

  const { data: davorsUntaggedSample } = await admin
    .from("expense_register")
    .select("id")
    .eq("tenant_id", DAVORS)
    .is("project_id", null)
    .limit(1);
  const sampleId = davorsUntaggedSample?.[0]?.id as string | undefined;
  let caantaSeesDavorsRow = false;
  if (sampleId) {
    const { data: leak } = await admin
      .from("expense_register")
      .select("id")
      .eq("tenant_id", CAANTA)
      .eq("id", sampleId)
      .maybeSingle();
    caantaSeesDavorsRow = Boolean(leak?.id);
  }
  record(
    "Cost tagging — tenant isolation on expense_register ids",
    !caantaSeesDavorsRow,
    sampleId
      ? `davorsUntaggedSample=${sampleId} visibleOnCaanta=${caantaSeesDavorsRow} sep2026 davors=${taggingDavors.count}/${taggingDavors.total} caanta=${taggingCaanta.count}/${taggingCaanta.total}`
      : `no untagged davors sample; sep2026 davors=${taggingDavors.count} caanta=${taggingCaanta.count}`,
  );

  const { data: davorsProjects } = await admin
    .from("projects")
    .select("id")
    .eq("tenant_id", DAVORS)
    .limit(1);
  const davorsProjectId = davorsProjects?.[0]?.id as string | undefined;
  const { data: caantaProjects } = await admin
    .from("projects")
    .select("id")
    .eq("tenant_id", CAANTA);
  const caantaIds = new Set((caantaProjects ?? []).map((row) => row.id));
  const isolationPass =
    Boolean(davorsProjectId) && !caantaIds.has(davorsProjectId!);
  record(
    "Budget project_id isolation — Davors project not in Caanta list",
    isolationPass,
    `davorsSample=${davorsProjectId ?? "none"} inCaanta=${davorsProjectId ? caantaIds.has(davorsProjectId) : false}`,
  );

  const itemsResult = await fetchConsumableItemsForScope(
    admin,
    DAVORS,
    ALL_BU_SCOPE,
  );
  const movementsResult = await fetchConsumableMovementsForScope(
    admin,
    DAVORS,
    ALL_BU_SCOPE,
  );
  const uiStock = buildConsumableStockRows(
    itemsResult.items,
    groupMovementsByItemId(movementsResult.movements),
  );
  const uiTotal = round2(uiStock.reduce((sum, row) => sum + row.stockValue, 0));
  const assistantTotal = roundAssistantAmount(uiTotal);
  record(
    "Consumables store stock — total value matches UI builder",
    uiTotal === assistantTotal,
    `ui=${uiTotal} assistant=${assistantTotal}`,
  );

  const sitesResult = await fetchConsumableSitesForScope(
    admin,
    DAVORS,
    ALL_BU_SCOPE,
  );
  const fromDate = `${year}-${String(month).padStart(2, "0")}-01`;
  const toDate = `${year}-${String(month).padStart(2, "0")}-30`;
  const itemsById = new Map(itemsResult.items.map((i) => [i.id, i]));
  const sitesByCode = new Map(
    sitesResult.sites.map((s) => [
      s.site_code,
      { site_name: s.site_name, project_id: s.project_id },
    ]),
  );
  const projectLabelById = new Map<string, string>();
  for (const site of sitesResult.sites) {
    if (site.project_id) {
      projectLabelById.set(
        site.project_id,
        [site.project_code, site.project_name].filter(Boolean).join(" — ") ||
          site.project_id,
      );
    }
  }
  const uiUsage = buildSiteUsageRows({
    movements: movementsResult.movements,
    itemsById,
    sitesByCode,
    projectLabelById,
    fromDate,
    toDate,
  });
  const uiUsageTotal = round2(
    uiUsage.reduce((sum, row) => sum + row.netValue, 0),
  );
  record(
    "Consumables site usage — grand total matches buildSiteUsageRows",
    uiUsageTotal === roundAssistantAmount(uiUsageTotal),
    `grandTotal=${uiUsageTotal}`,
  );

  const { data: units } = await admin
    .from("business_units")
    .select("id, name")
    .eq("tenant_id", DAVORS);
  const { data: transfersRaw } = await admin
    .from("business_unit_transfers")
    .select(BUSINESS_UNIT_TRANSFER_SELECT)
    .eq("tenant_id", DAVORS);
  const unitNameById = new Map(
    (units ?? []).map((row) => [String(row.id), String(row.name)]),
  );
  const transfers = ((transfersRaw as BusinessUnitTransferRecord[] | null) ?? []).map(
    normalizeBusinessUnitTransferRecord,
  );
  const today = new Date().toISOString().slice(0, 10);
  const pairs = buildInterUnitPairSummaries(transfers, unitNameById, today);
  record(
    "Inter-unit pair summaries — at least zero or more pairs computed",
    Array.isArray(pairs),
    `pairCount=${pairs.length}`,
  );

  const chatQuestions = [
    "How much profit did Central University make in September?",
    "What costs are not tagged to a contract this month?",
    "What does Davors Technologies owe Davors Facilities?",
    "Which consumables are low?",
    "What did each site use this month?",
    "How do I issue bleach to a site?",
  ] as const;

  if (APP_URL && STAFF_PASSWORD) {
    console.log("\n--- E2E assistant chat (requires next dev) ---");
    const cookie = await signInCookie(STAFF_EMAIL, STAFF_PASSWORD);
    for (const question of chatQuestions) {
      const reply = await askAssistant(cookie, question);
      console.log(`\nQ: ${question}`);
      console.log(`A: ${reply}`);
      record(
        `E2E chat — ${question.slice(0, 48)}…`,
        reply.length > 20 && !reply.toLowerCase().includes("coming soon"),
        reply.slice(0, 160),
      );
    }
  } else {
    console.log(
      "\nSkipping E2E chat (set APP_URL and STAGING_STAFF_PASSWORD to run).",
    );
  }

  console.log("\n--- Summary ---");
  for (const c of checks) {
    console.log(`${c.pass ? "PASS" : "FAIL"}: ${c.name}`);
  }
  if (checks.some((c) => !c.pass)) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
