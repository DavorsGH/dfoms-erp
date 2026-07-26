/**
 * Compare Statutory Liabilities Report totals vs Statutory Ledger overview
 * for Davors on staging.
 * Usage: node scripts/verify-statutory-liabilities-report-staging.mjs
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { resolveDatabaseUrl } from "./resolve-database-url.mjs";

function loadEnvForce(filePath) {
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i === -1) continue;
    process.env[trimmed.slice(0, i).trim()] = trimmed.slice(i + 1).trim();
  }
}

loadEnvForce(resolve(process.cwd(), ".env.staging.local"));

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const projectRef = new URL(url).hostname.split(".")[0];
if (projectRef !== "wieflwbfdmjtsdnwbfii") {
  throw new Error(`REFUSING: expected staging, got ${projectRef}`);
}
if (!serviceKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY missing");

const DAVORS = "00000001-0000-4000-8000-000000000001";

// Inline summarizeOpenTaxBalances (same logic as tax-ledger-utils)
function summarizeOpenTaxBalances(entries) {
  const summary = {
    whtReceivable: 0,
    whtPayable: 0,
    outputVatBundle: 0,
    outputVfrs: 0,
    outputTotal: 0,
    inputTax: 0,
    netVatPosition: 0,
    payePayable: 0,
    ssnitEmployee: 0,
    ssnitEmployerTier1: 0,
    ssnitTier2: 0,
  };
  for (const entry of entries) {
    if (entry.status !== "open") continue;
    const amount = Number(entry.tax_amount) || 0;
    switch (entry.direction) {
      case "wht_receivable":
        summary.whtReceivable += amount;
        break;
      case "wht_payable":
        summary.whtPayable += amount;
        break;
      case "output":
        summary.outputTotal += amount;
        if (entry.tax_component === "vfrs") summary.outputVfrs += amount;
        else summary.outputVatBundle += amount;
        break;
      case "input":
        summary.inputTax += amount;
        break;
      case "statutory_payable":
        if (entry.tax_component === "paye") summary.payePayable += amount;
        else if (entry.tax_component === "ssnit_employee")
          summary.ssnitEmployee += amount;
        else if (entry.tax_component === "ssnit_employer_tier1")
          summary.ssnitEmployerTier1 += amount;
        else if (entry.tax_component === "ssnit_tier2")
          summary.ssnitTier2 += amount;
        break;
      default:
        break;
    }
  }
  summary.netVatPosition = summary.outputTotal - summary.inputTax;
  return summary;
}

const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data, error } = await admin
  .from("tax_ledger_entries")
  .select("status, period_month, tax_amount, direction, tax_component")
  .eq("tenant_id", DAVORS);

if (error) throw new Error(error.message);

const summary = summarizeOpenTaxBalances(data ?? []);
const report = {
  SSNIT:
    summary.ssnitEmployee +
    summary.ssnitEmployerTier1 +
    summary.ssnitTier2,
  PAYE: summary.payePayable,
  VAT: summary.netVatPosition > 0 ? summary.netVatPosition : 0,
  "WHT Payable": summary.whtPayable,
};

console.log("Davors open tax_ledger count:", (data ?? []).length);
console.log("Statutory Ledger overview components:", {
  payePayable: summary.payePayable,
  ssnitEmployee: summary.ssnitEmployee,
  ssnitEmployerTier1: summary.ssnitEmployerTier1,
  ssnitTier2: summary.ssnitTier2,
  netVatPosition: summary.netVatPosition,
  whtPayable: summary.whtPayable,
});
console.log("Statutory Liabilities Report group totals:", report);

void resolveDatabaseUrl; // keep import used if present
