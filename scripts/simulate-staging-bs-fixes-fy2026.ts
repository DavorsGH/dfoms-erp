/**
 * Read-only: simulate staging BS gap after proposed data fixes (no writes).
 * Usage: npx tsx scripts/simulate-staging-bs-fixes-fy2026.ts
 */
// @ts-nocheck
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  buildBalanceSheetReport,
  getBalanceCheckForPeriod,
} from "../app/dashboard/finance/balance-sheet-utils";
import { fetchInventoryBalanceSheetInput } from "../app/dashboard/finance/balance-sheet-page-data";
import {
  fetchPayrollLiveRecalcBundle,
  mergePayrollWagesWithLiveOpenMonths,
} from "../app/dashboard/hr-payroll/payroll-live-recalc-utils";

const TENANT = "00000001-0000-4000-8000-000000000001";
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function loadEnv(p) {
  for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    process.env[t.slice(0, i).trim()] = v;
  }
}

function r2(n) { return Math.round(Number(n || 0) * 100) / 100; }

async function loadAll(admin) {
  const [inc, exp, fa, ap, cap, man, pp, mec, tax, ph, live, inv] = await Promise.all([
    admin.from("income_register").select("*").eq("tenant_id", TENANT),
    admin.from("expense_register").select("*").eq("tenant_id", TENANT),
    admin.from("fixed_assets").select("*").eq("tenant_id", TENANT),
    admin.from("accounts_payable").select("*").eq("tenant_id", TENANT),
    admin.from("capital_contributions").select("*").eq("tenant_id", TENANT),
    admin.from("manual_financial_entries").select("*").eq("tenant_id", TENANT),
    admin.from("payroll_processing").select("*").eq("tenant_id", TENANT),
    admin.from("month_end_close").select("*").eq("tenant_id", TENANT),
    admin.from("tax_ledger_entries").select("*").eq("tenant_id", TENANT),
    admin.from("payroll_history").select("payroll_month, net_pay").eq("tenant_id", TENANT),
    fetchPayrollLiveRecalcBundle(admin, { tenantId: TENANT }),
    fetchInventoryBalanceSheetInput(admin, TENANT),
  ]);
  const wages = mergePayrollWagesWithLiveOpenMonths(ph.data ?? [], pp.data ?? [], live.employees, live.liveContext);
  const cashFlow = (exp.data ?? []).map((e) => ({
    date: e.date, expense_category: e.expense_category ?? "", sub_category: e.sub_category ?? "",
    amount: e.amount, payment_status: e.payment_status, description: e.description ?? null,
    receipt_no: e.receipt_no ?? null, notes: e.notes ?? null,
  }));
  return { income: inc.data ?? [], expenses: exp.data ?? [], fixedAssets: fa.data ?? [], payables: ap.data ?? [], capital: cap.data ?? [], manual: man.data ?? [], monthEndClose: mec.data ?? [], taxLedger: tax.data ?? [], wages, cashFlow, inv };
}

function audit(label, bundle, refDate = new Date("2026-12-31T12:00:00")) {
  const inv = { ...bundle.inv, referenceDate: refDate };
  const bs = buildBalanceSheetReport(bundle.income, bundle.expenses, bundle.fixedAssets, bundle.payables, bundle.capital, bundle.cashFlow, bundle.wages, bundle.monthEndClose, 2026, inv, bundle.manual, bundle.taxLedger);
  console.log(`\n=== ${label} (as-at ${refDate.toISOString().slice(0,10)}) ===`);
  for (let i = 0; i < 12; i++) {
    const c = getBalanceCheckForPeriod(bs, i);
    if (!c.isBalanced) console.log(`${MONTHS[i]}: diff=${r2(c.difference).toFixed(2)}`);
  }
  const dec = getBalanceCheckForPeriod(bs, 11);
  console.log(`Dec diff=${r2(dec.difference).toFixed(2)} balanced=${dec.isBalanced}`);
  console.log({
    netVatPayable: r2(bs.rows.find(r => r.key === "net-vat-payable")?.amounts[11] ?? 0),
    inventory: r2(bs.rows.find(r => r.key === "inventory")?.amounts[11] ?? 0),
    invOpeningEq: r2(bs.rows.find(r => r.key === "inventory-opening-equity")?.amounts[11] ?? 0),
  });
}

async function main() {
  loadEnv(resolve(".env.staging.local"));
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const base = await loadAll(admin);

  audit("BASELINE (current staging)", base, new Date("2026-12-31T12:00:00"));
  audit("BASELINE (today Aug-8 ref)", base, new Date("2026-08-08T12:00:00"));

  const fixA = structuredClone(base);
  fixA.taxLedger = fixA.taxLedger.map((t) => t.status === "open" ? { ...t, status: "paid" } : t);
  audit("FIX A: mark all open tax paid", fixA, new Date("2026-12-31T12:00:00"));

  const fixB = structuredClone(base);
  if (fixB.inv.config) fixB.inv.config = { ...fixB.inv.config, opening_inventory_value: 125 };
  audit("FIX B: opening_inventory_value=125 only", fixB, new Date("2026-12-31T12:00:00"));

  const fixAB = structuredClone(base);
  fixAB.taxLedger = fixAB.taxLedger.map((t) => t.status === "open" ? { ...t, status: "paid" } : t);
  if (fixAB.inv.config) fixAB.inv.config = { ...fixAB.inv.config, opening_inventory_value: 125 };
  audit("FIX A+B: tax paid + opening inventory 125", fixAB, new Date("2026-12-31T12:00:00"));

  const juneInvId = "381db9c1-e52e-443d-9b42-c6e352427262";
  const augTaxIds = new Set(["d4b80f19-25a5-474a-9587-6c63cf678bc3","304cf8e9-e30b-4ade-8e09-f00ab657d69e","38e5f56f-9a6b-48aa-8e7c-0d327ffaf4cc"]);
  const fixC = structuredClone(base);
  fixC.income = fixC.income.filter((r) => r.id !== juneInvId);
  fixC.taxLedger = fixC.taxLedger.filter((t) => t.source_id !== juneInvId);
  audit("FIX C: delete June INV-2026-06-001 + tax legs", fixC, new Date("2026-12-31T12:00:00"));

  const fixD = structuredClone(fixC);
  fixD.income = fixD.income.filter((r) => !augTaxIds.has(r.id) && r.invoice_no !== "RE-MGMT-FEE-1b2225f5-182d-4f1c-a97a-8034aa52e5ae" && !String(r.invoice_no || "").startsWith("DF-POS-"));
  fixD.taxLedger = fixD.taxLedger.filter((t) => !augTaxIds.has(t.source_id ?? ""));
  fixD.expenses = fixD.expenses.filter((e) => !String(e.receipt_no || "").startsWith("COGS-DF-POS") && !String(e.receipt_no || "").startsWith("VOID-COGS-DF-POS"));
  fixD.inv = { ...fixD.inv, rawMaterials: [], finishedProducts: [], finishedProductAverageCosts: [] };
  audit("FIX D: delete all FY2026 test income/tax/POS + zero inventory", fixD, new Date("2026-12-31T12:00:00"));

  const fixE = structuredClone(fixA);
  fixE.capital = fixE.capital.filter(
    (c) => String(c.date) !== "2026-06-30" && String(c.date) !== "2026-06-09",
  );
  audit("FIX E: tax paid + remove Jun capital contributions", fixE, new Date("2026-12-31T12:00:00"));

  const fixF = structuredClone(fixA);
  if (fixF.inv.config) fixF.inv.config = { ...fixF.inv.config, opening_inventory_value: 125 };
  fixF.inv = { ...fixF.inv, finishedProducts: [], finishedProductAverageCosts: [], rawMaterials: [] };
  audit("FIX F: tax paid + wipe Soda Water inventory rows", fixF, new Date("2026-12-31T12:00:00"));

  const fixG = structuredClone(fixE);
  if (fixG.inv.config) fixG.inv.config = { ...fixG.inv.config, opening_inventory_value: 125 };
  fixG.inv = { ...fixG.inv, finishedProducts: [], finishedProductAverageCosts: [], rawMaterials: [] };
  audit("FIX G: tax paid + remove Jun cap + wipe inventory", fixG, new Date("2026-12-31T12:00:00"));

  const fixH = structuredClone(fixA);
  fixH.capital = [];
  audit("FIX H: tax paid + remove ALL capital contributions", fixH, new Date("2026-12-31T12:00:00"));

  const fixI = structuredClone(fixC);
  fixI.taxLedger = fixI.taxLedger.map((t) => t.status === "open" ? { ...t, status: "paid" } : t);
  audit("FIX I: delete June invoice + mark remaining tax paid", fixI, new Date("2026-12-31T12:00:00"));

  const fixJ = structuredClone(fixI);
  fixJ.inv = { ...fixJ.inv, finishedProducts: [], finishedProductAverageCosts: [], rawMaterials: [] };
  if (fixJ.inv.config) fixJ.inv.config = { ...fixJ.inv.config, opening_inventory_value: 0 };
  audit("FIX J: Fix I + wipe inventory", fixJ, new Date("2026-12-31T12:00:00"));

  const fixK = structuredClone(base);
  fixK.income = fixK.income.filter((r) => r.id !== juneInvId);
  fixK.taxLedger = fixK.taxLedger.filter((t) => t.source_id !== juneInvId).map((t) => t.status === "open" ? { ...t, status: "paid" } : t);
  fixK.capital = [];
  fixK.inv = { ...fixK.inv, finishedProducts: [], finishedProductAverageCosts: [], rawMaterials: [] };
  audit("FIX K: delete June invoice, mark tax paid, clear cap, wipe inventory", fixK, new Date("2026-12-31T12:00:00"));
}

main().catch((e) => { console.error(e); process.exit(1); });
