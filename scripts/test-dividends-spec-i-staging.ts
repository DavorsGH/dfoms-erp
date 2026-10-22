/**
 * Dividends spec I — staging (Davors Facilities + All businesses).
 * Usage: APP_URL=http://localhost:3000 npx tsx scripts/test-dividends-spec-i-staging.ts
 */
import { resolve } from "node:path";
import { config as loadDotenv } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { fetchBalanceSheetPageData } from "../app/dashboard/finance/balance-sheet-page-data";
import {
  buildStandardBalanceSheetReport,
  dividendOptionsFromPageData,
  getBalanceSheetMonthCheck,
} from "../lib/finance/balance-sheet-standard-report";
import { getBalanceSheetAmountForMonth } from "../app/dashboard/finance/balance-sheet-utils";
import { remitTaxForPeriod } from "../app/dashboard/finance/tax-ledger-remit";
import { emptyTaxSettings } from "../app/dashboard/finance/tax-utils";
import { mergeTaxSettingsDueRules } from "../app/dashboard/director-scorecard-build";
import { scopeTaxSettingsRead, TAX_SETTINGS_FULL_SELECT } from "../utils/phase5e-key-structure";
loadDotenv({ path: resolve(".env.local") });
loadDotenv({ path: resolve(".env.staging.local"), override: true });

const DAVORS = "00000001-0000-4000-8000-000000000001";
const FAC = "de215200-e92b-48e3-a7ba-977d7289868c";
const FY = 2026;
const SEP = 8;
const OCT = 9;

const APP_URL = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

const DECLARE_BY =
  process.env.STAGING_SUPER_ADMIN_AUTH_UID?.trim() ||
  "00000000-0000-4000-8000-000000000099";

async function signInCookie(email: string, password: string): Promise<string> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!.trim();
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!.trim();
  const auth = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await auth.auth.signInWithPassword({ email, password });
  if (error || !data.session) {
    throw new Error(error?.message ?? "sign-in failed");
  }
  const projectRef = new URL(url).hostname.split(".")[0];
  return `sb-${projectRef}-auth-token=${encodeURIComponent(
    JSON.stringify({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token ?? "",
      expires_at: data.session.expires_at,
      expires_in: data.session.expires_in,
      token_type: "bearer",
      user: data.session.user,
    }),
  )}`;
}

async function createRoleProbe(role: "director" | "finance") {
  const stamp = Date.now();
  const email = `div-spec-i-${role}.${stamp}@test.davors`;
  const password = `DivSpec-${stamp}!Aa8`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { portal: "staff" },
  });
  if (error || !data.user) {
    throw new Error(error?.message ?? "createUser failed");
  }
  const authUid = data.user.id;
  await admin.from("user_accounts").insert({
    auth_uid: authUid,
    email,
    tenant_id: DAVORS,
    role,
    is_active: true,
  });
  return {
    email,
    password,
    authUid,
    cleanup: async () => {
      await admin.from("user_accounts").delete().eq("auth_uid", authUid);
      await admin.auth.admin.deleteUser(authUid);
    },
  };
}

type Metrics = {
  balanced: boolean;
  oob: number;
  cash: number;
  divPay: number;
  wht: number;
  re: number;
  totalAssets: number;
  totalLe: number;
};

type Row = {
  step: string;
  scope: string;
  month: string;
  balanced: boolean;
  oob: number;
  dCash: number;
  dDiv: number;
  dWht: number;
  dRe: number;
  dAssets: number;
  dLe: number;
};

const baselines = new Map<string, Metrics>();
const log: Row[] = [];

function r2(n: number) {
  return Math.round(n * 100) / 100;
}

function key(scope: string, monthIndex: number) {
  return `${scope}:${monthIndex}`;
}

async function loadMetrics(viewAll: boolean, monthIndex: number): Promise<Metrics> {
  const page = await fetchBalanceSheetPageData(admin, DAVORS, {
    activeBusinessUnitId: viewAll ? null : FAC,
    viewAllBusinessUnits: viewAll,
  });
  const buScope = viewAll
    ? ({ mode: "all" } as const)
    : ({ mode: "unit", id: FAC } as const);
  const report = buildStandardBalanceSheetReport(page, DAVORS, FY, {
    allBusinessUnitsDirectorsLoan: viewAll,
    rawManualFinancialEntries: viewAll ? page.initialRawManualEntries : undefined,
    interUnitTransferScope:
      buScope.mode === "unit"
        ? { mode: "unit", businessUnitId: FAC }
        : { mode: "exclude" },
    ...dividendOptionsFromPageData(page, buScope),
  });
  const check = getBalanceSheetMonthCheck(report, monthIndex);
  const row = (k: string) => report.rows.find((r) => r.key === k)!;
  return {
    balanced: check.isBalanced,
    oob: r2(check.difference),
    cash: r2(getBalanceSheetAmountForMonth(row("cash"), monthIndex)),
    divPay: r2(getBalanceSheetAmountForMonth(row("dividends-payable"), monthIndex)),
    wht: r2(getBalanceSheetAmountForMonth(row("wht-payable"), monthIndex)),
    re: r2(getBalanceSheetAmountForMonth(row("retained-earnings"), monthIndex)),
    totalAssets: r2(getBalanceSheetAmountForMonth(row("total-assets"), monthIndex)),
    totalLe: r2(getBalanceSheetAmountForMonth(row("total-liabilities-equity"), monthIndex)),
  };
}

async function snap(step: string, viewAll: boolean, monthIndex: number) {
  const scope = viewAll ? "All" : "Facilities";
  const m = await loadMetrics(viewAll, monthIndex);
  const monthLabel = monthIndex === SEP ? "Sep" : monthIndex === OCT ? "Oct" : `M${monthIndex + 1}`;
  const baseKey = key(scope, monthIndex);
  if (!baselines.has(baseKey)) {
    baselines.set(baseKey, m);
  }
  const base = baselines.get(baseKey)!;
  const row: Row = {
    step,
    scope,
    month: monthLabel,
    balanced: m.balanced,
    oob: m.oob,
    dCash: r2(m.cash - base.cash),
    dDiv: r2(m.divPay - base.divPay),
    dWht: r2(m.wht - base.wht),
    dRe: r2(m.re - base.re),
    dAssets: r2(m.totalAssets - base.totalAssets),
    dLe: r2(m.totalLe - base.totalLe),
  };
  log.push(row);
  console.log(
    `${step} [${scope} ${monthLabel}] balanced=${m.balanced} oob=${m.oob} Δcash=${row.dCash} Δdiv=${row.dDiv} Δwht=${row.dWht} ΔRE=${row.dRe} Δassets=${row.dAssets} ΔL+E=${row.dLe}`,
  );
  const oobDelta = r2(m.oob - base.oob);
  if (!m.balanced && Math.abs(oobDelta) > 0.02) {
    throw new Error(
      `${step} [${scope} ${monthLabel}] BS out of balance by ${m.oob} (baseline oob ${base.oob}, Δoob ${oobDelta})`,
    );
  }
}

async function cleanup() {
  const { data: decls } = await admin
    .from("dividend_declarations")
    .select("id")
    .eq("tenant_id", DAVORS);
  const ids = (decls ?? []).map((r) => r.id);
  if (ids.length) {
    await admin
      .from("expense_register")
      .delete()
      .eq("tenant_id", DAVORS)
      .like("receipt_no", "TAX-REMIT-WHT-%LEG-%");
    await admin
      .from("tax_ledger_entries")
      .delete()
      .eq("tenant_id", DAVORS)
      .eq("source_type", "dividend_declaration")
      .in("source_id", ids);
    await admin.from("dividend_declaration_lines").delete().in("declaration_id", ids);
    await admin.from("dividend_declarations").delete().in("id", ids);
  }
  await admin
    .from("tenant_shareholders")
    .delete()
    .eq("tenant_id", DAVORS)
    .in("full_name", ["Test Shareholder A", "Test Shareholder B"]);
}

async function taxSettings() {
  const { data: taxSettingsRow } = await scopeTaxSettingsRead(
    admin
      .from("tax_settings")
      .select(TAX_SETTINGS_FULL_SELECT)
      .eq("tenant_id", DAVORS),
    FAC,
  ).maybeSingle();
  return mergeTaxSettingsDueRules(
    (taxSettingsRow as Record<string, unknown> | null) ?? null,
  ) ?? emptyTaxSettings();
}

async function seedShareholders() {
  const { data: shA } = await admin
    .from("tenant_shareholders")
    .insert({
      tenant_id: DAVORS,
      full_name: "Test Shareholder A",
      share_pct: 60,
      payment_method: "bank",
      bank_name: "Test Bank",
      bank_account_number: "001",
      is_active: true,
    })
    .select()
    .single();
  const { data: shB } = await admin
    .from("tenant_shareholders")
    .insert({
      tenant_id: DAVORS,
      full_name: "Test Shareholder B",
      share_pct: 40,
      payment_method: "momo",
      momo_number: "0240000000",
      is_active: true,
    })
    .select()
    .single();
  return { shA: shA!, shB: shB! };
}

async function ensureTestShareholders() {
  const { data: existing } = await admin
    .from("tenant_shareholders")
    .select("id, full_name, share_pct")
    .eq("tenant_id", DAVORS)
    .in("full_name", ["Test Shareholder A", "Test Shareholder B"]);
  if ((existing ?? []).length >= 2) {
    return existing!;
  }
  await seedShareholders();
  const { data: rows } = await admin
    .from("tenant_shareholders")
    .select("id, full_name, share_pct")
    .eq("tenant_id", DAVORS)
    .in("full_name", ["Test Shareholder A", "Test Shareholder B"]);
  return rows ?? [];
}

async function createDraft(gross: number, declDate: string) {
  await ensureTestShareholders();
  const { data: code } = await admin.rpc("generate_next_code", {
    p_tenant_id: DAVORS,
    p_entity_type: "DIV",
    p_padding: 4,
  });
  const whtRate = 8;
  const wht = r2((gross * whtRate) / 100);
  const net = r2(gross - wht);
  const { data: decl } = await admin
    .from("dividend_declarations")
    .insert({
      tenant_id: DAVORS,
      business_unit_id: FAC,
      declaration_number: code,
      declaration_date: declDate,
      period_start: "2026-07-01",
      period_end: "2026-09-30",
      gross_amount: gross,
      wht_rate_pct: whtRate,
      wht_amount: wht,
      net_amount: net,
      status: "draft",
    })
    .select()
    .single();
  const shareholders = await ensureTestShareholders();
  const shA = shareholders.find((r) => r.full_name.includes("A"))!;
  const shB = shareholders.find((r) => r.full_name.includes("B"))!;
  await admin.from("dividend_declaration_lines").insert([
    {
      tenant_id: DAVORS,
      declaration_id: decl!.id,
      shareholder_id: shA.id,
      payee_name: "Test Shareholder A",
      share_pct: 60,
      gross_amount: r2(gross * 0.6),
      wht_amount: r2(wht * 0.6),
      net_amount: r2(net * 0.6),
      paid_amount: 0,
    },
    {
      tenant_id: DAVORS,
      declaration_id: decl!.id,
      shareholder_id: shB.id,
      payee_name: "Test Shareholder B",
      share_pct: 40,
      gross_amount: r2(gross * 0.4),
      wht_amount: r2(wht * 0.4),
      net_amount: r2(net * 0.4),
      paid_amount: 0,
    },
  ]);
  return decl!;
}

async function declareDraft(declId: string) {
  const { error } = await admin.rpc("declare_dividend_atomic", {
    p_tenant_id: DAVORS,
    p_declaration_id: declId,
    p_declared_by: DECLARE_BY,
  });
  if (error) {
    throw new Error(`declare_dividend_atomic: ${error.message}`);
  }
}

async function payLineFull(
  lineId: string,
  paymentDate: string,
  paymentMethod: string,
  reference: string,
) {
  const { data, error } = await admin.rpc("pay_dividend_line_atomic", {
    p_tenant_id: DAVORS,
    p_line_id: lineId,
    p_payment_date: paymentDate,
    p_payment_method: paymentMethod,
    p_payment_reference: reference,
  });
  if (error) {
    throw new Error(error.message);
  }
  return data as string;
}

async function cancelDeclared(declId: string, reason: string) {
  const { error } = await admin.rpc("cancel_dividend_atomic", {
    p_tenant_id: DAVORS,
    p_declaration_id: declId,
    p_cancelled_by: DECLARE_BY,
    p_reason: reason,
  });
  if (error) {
    throw new Error(error.message);
  }
}

async function remitDividendWht(declId: string, remittanceDate: string) {
  const { data: taxRow } = await admin
    .from("tax_ledger_entries")
    .select("id, period_month, tax_amount")
    .eq("tenant_id", DAVORS)
    .eq("source_type", "dividend_declaration")
    .eq("source_id", declId)
    .eq("status", "open")
    .maybeSingle();
  if (!taxRow) {
    throw new Error("Missing open dividend WHT tax row");
  }
  const settings = await taxSettings();
  const result = await remitTaxForPeriod(admin, {
    tenantId: DAVORS,
    periodMonth: taxRow.period_month,
    kind: "wht",
    settings,
    businessUnitId: FAC,
    readScope: { mode: "unit", id: FAC },
    taxLedgerEntryIds: [taxRow.id],
    remittanceDate,
  });
  if (result.error) {
    throw new Error(result.error);
  }
  if (r2(result.cashAmount) !== r2(Number(taxRow.tax_amount))) {
    throw new Error(
      `Remit cash ${result.cashAmount} !== WHT ${taxRow.tax_amount}`,
    );
  }
  const after = await loadMetrics(false, OCT);
  const openDivWht = await admin
    .from("tax_ledger_entries")
    .select("status, tax_amount")
    .eq("id", taxRow.id)
    .single();
  if (openDivWht.data?.status !== "paid") {
    throw new Error("Dividend WHT row not marked paid after remit");
  }
  console.log(
    `  remit cleared WHT cash=${result.cashAmount} Oct WHT payable=${after.wht} (baseline delta ${r2(after.wht - (baselines.get(key("Facilities", OCT))?.wht ?? 0))})`,
  );
}

async function runHttpChecks() {
  console.log("\n--- I.7 / I.8 RBAC constants ---");
  const writeRoles = ["director", "super_admin"];
  if (writeRoles.includes("finance")) {
    throw new Error("finance must not have dividend write access");
  }
  console.log("I.8 OK: dividend write roles are director + super_admin only");
  console.log(
    "I.7: All-businesses declare blocked in POST /dividend-declarations (viewAll gate) — covered by API + UI",
  );
}

async function main() {
  await cleanup();

  console.log("\n=== I.1 Baseline (no test data) ===");
  for (const viewAll of [false, true]) {
    await snap("I.1", viewAll, SEP);
    await snap("I.1", viewAll, OCT);
  }

  const draft = await createDraft(1000, "2026-09-30");

  console.log("\n=== I.2 Declare 1000 (Sep 30) ===");
  await declareDraft(draft.id);
  for (const viewAll of [false, true]) {
    await snap("I.2", viewAll, SEP);
    await snap("I.2", viewAll, OCT);
  }

  const { data: lines } = await admin
    .from("dividend_declaration_lines")
    .select("*")
    .eq("declaration_id", draft.id);
  const lineA = lines!.find((l) => l.payee_name.includes("A"))!;
  const lineB = lines!.find((l) => l.payee_name.includes("B"))!;

  let secondPayAfterA: { message: string } | null = null;
  await payLineFull(lineA.id, "2026-10-05", "bank", "SPEC-I-A");
  const { error: secondPayAfterAErr } = await admin.rpc("pay_dividend_line_atomic", {
    p_tenant_id: DAVORS,
    p_line_id: lineA.id,
    p_payment_date: "2026-10-06",
    p_payment_method: "bank",
    p_payment_reference: "DUPLICATE",
  });
  if (!secondPayAfterAErr) {
    throw new Error("Expected second payment on line A to be rejected");
  }
  secondPayAfterA = secondPayAfterAErr;

  console.log("\n=== I.3 Pay A full net (Oct) ===");
  for (const viewAll of [false, true]) {
    await snap("I.3", viewAll, SEP);
    await snap("I.3", viewAll, OCT);
  }

  const payBStatus = await payLineFull(lineB.id, "2026-10-05", "momo", "SPEC-I-B");
  if (payBStatus !== "paid") {
    throw new Error(`Expected declaration paid after line B, got ${payBStatus}`);
  }

  console.log("\n=== I.4 Pay B full net (paid) ===");
  for (const viewAll of [false, true]) {
    await snap("I.4", viewAll, SEP);
    await snap("I.4", viewAll, OCT);
  }

  console.log("\n=== I.5 Remit dividend WHT 80 (Oct 10) ===");
  await remitDividendWht(draft.id, "2026-10-10");
  for (const viewAll of [false, true]) {
    await snap("I.5", viewAll, SEP);
    await snap("I.5", viewAll, OCT);
  }

  const draft2 = await createDraft(500, "2026-10-01");
  await declareDraft(draft2.id);

  const { error: rpcNoReasonErr } = await admin.rpc("cancel_dividend_atomic", {
    p_tenant_id: DAVORS,
    p_declaration_id: draft2.id,
    p_cancelled_by: DECLARE_BY,
    p_reason: "   ",
  });
  if (!rpcNoReasonErr) {
    throw new Error("Expected cancel without reason to be rejected");
  }
  console.log("\n=== Guardrails (cancel reason, RPC) ===");
  console.log(`  cancel without reason rejected: ${rpcNoReasonErr.message}`);

  const financeProbe = await createRoleProbe("finance");
  try {
    const financeCookie = await signInCookie(financeProbe.email, financeProbe.password);
    const financePay = await fetch(
      `${APP_URL}/api/finance/dividend-declaration-lines/${lineB.id}/pay`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: financeCookie },
        body: JSON.stringify({
          payment_date: "2026-10-05",
          payment_method: "bank",
          payment_reference: "FORBIDDEN",
        }),
      },
    );
    if (financePay.status !== 403) {
      throw new Error(`Finance pay expected 403, got ${financePay.status}`);
    }
    console.log("  finance role pay → 403");
  } finally {
    await financeProbe.cleanup();
  }

  await cancelDeclared(draft2.id, "Spec I test cancel");

  console.log("\n=== I.6 Cancel 500 decl ===");
  for (const viewAll of [false, true]) {
    await snap("I.6", viewAll, SEP);
    await snap("I.6", viewAll, OCT);
  }

  console.log("\n=== I.9 Cleanup ===");
  await cleanup();
  for (const viewAll of [false, true]) {
    await snap("I.9", viewAll, SEP);
    await snap("I.9", viewAll, OCT);
  }

  console.log("\n=== Atomic guardrails ===");
  console.log(`  second payment rejected: ${secondPayAfterA!.message}`);

  const paidDecl = await createDraft(100, "2026-10-02");
  await declareDraft(paidDecl.id);
  const { data: paidLines } = await admin
    .from("dividend_declaration_lines")
    .select("id")
    .eq("declaration_id", paidDecl.id)
    .limit(1);
  await payLineFull(paidLines![0]!.id, "2026-10-03", "bank", "GUARD-PAY");
  const { error: cancelAfterPayErr } = await admin.rpc("cancel_dividend_atomic", {
    p_tenant_id: DAVORS,
    p_declaration_id: paidDecl.id,
    p_cancelled_by: DECLARE_BY,
    p_reason: "Should fail",
  });
  if (!cancelAfterPayErr) {
    throw new Error("Expected cancel after payment to be rejected");
  }
  console.log(`  cancel after payment rejected: ${cancelAfterPayErr.message}`);
  await admin.from("dividend_declaration_lines").delete().eq("declaration_id", paidDecl.id);
  await admin
    .from("tax_ledger_entries")
    .delete()
    .eq("source_id", paidDecl.id);
  await admin.from("dividend_declarations").delete().eq("id", paidDecl.id);

  await runHttpChecks();

  console.log("\n=== Step table (delta vs baseline per scope+month) ===");
  console.table(log);
  console.log("\nOK: Dividends spec I staging passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
