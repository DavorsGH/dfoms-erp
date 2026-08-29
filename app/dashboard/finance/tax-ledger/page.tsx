import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import {
  getActiveBusinessUnitId,
  getCurrentUserTenantId,
  getViewAllBusinessUnits,
} from "@/utils/dashboard-auth";
import { resolveStampBusinessUnitId } from "@/utils/business-unit-view";
import {
  TAX_SETTINGS_ON_CONFLICT,
  scopeTaxSettingsRead,
} from "@/utils/phase5e-key-structure";
import FinanceNav from "../finance-nav";
import TaxLedger from "../tax-ledger";
import {
  TAX_SETTINGS_FULL_SELECT,
  emptyTaxSettings,
  normalizeTaxSettings,
  type TaxSettings,
} from "../tax-utils";
import {
  TAX_LEDGER_SELECT,
  buildAutoAdvancedDueDatePatch,
  normalizeTaxLedgerEntry,
  type TaxLedgerEntry,
} from "../tax-ledger-utils";

export default async function TaxLedgerPage() {
  const tenantId = await getCurrentUserTenantId();

  if (!tenantId) {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-semibold text-[#0f2744]">Finance</h1>
        <FinanceNav />
        <h2 className="mb-6 text-xl font-semibold text-[#0f2744]">Statutory Ledger</h2>
        <p className="text-sm text-red-700">
          Unable to resolve your workspace. Contact support if this persists.
        </p>
      </div>
    );
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const [activeBusinessUnitId, viewAllBusinessUnits] = await Promise.all([
    getActiveBusinessUnitId(),
    getViewAllBusinessUnits(),
  ]);

  const stamp = resolveStampBusinessUnitId({
    viewAllBusinessUnits,
    activeBusinessUnitId,
  });

  // Upsert-on-first-load: ensure one tax_settings row for this tenant + BU
  // context. Skipped while All Businesses is selected (not a stamp target).
  const { error: ensureError } = stamp.ok
    ? await supabase.from("tax_settings").upsert(
        { tenant_id: tenantId, business_unit_id: stamp.businessUnitId },
        { onConflict: TAX_SETTINGS_ON_CONFLICT, ignoreDuplicates: true },
      )
    : { error: null };

  const [
    { data: settingsData, error: settingsError },
    { data: entriesData, error: entriesError },
  ] = await Promise.all([
    scopeTaxSettingsRead(
      supabase
        .from("tax_settings")
        .select(TAX_SETTINGS_FULL_SELECT)
        .eq("tenant_id", tenantId),
      activeBusinessUnitId,
    ).maybeSingle(),
    supabase
      .from("tax_ledger_entries")
      .select(TAX_LEDGER_SELECT)
      .eq("tenant_id", tenantId)
      .order("entry_date", { ascending: false })
      .order("created_at", { ascending: false }),
  ]);

  let settings =
    normalizeTaxSettings(settingsData as TaxSettings | null) ??
    emptyTaxSettings(tenantId);

  const entries = ((entriesData as TaxLedgerEntry[] | null) ?? []).map(
    normalizeTaxLedgerEntry,
  );

  // Auto-advance stale next_*_due_date values when the obligation is gone
  // (no open ledger rows for that due kind). Keeps overdue dates when open
  // remittance obligations remain.
  const dueDatePatch = buildAutoAdvancedDueDatePatch(settings, entries);
  let autoAdvanceError: string | null = null;

  if (Object.keys(dueDatePatch).length > 0) {
    const { data: advancedRow, error: advanceError } = await scopeTaxSettingsRead(
      supabase
        .from("tax_settings")
        .update(dueDatePatch)
        .eq("tenant_id", tenantId),
      activeBusinessUnitId,
    )
      .select(TAX_SETTINGS_FULL_SELECT)
      .single();

    if (advanceError) {
      autoAdvanceError = advanceError.message;
    } else if (advancedRow) {
      settings =
        normalizeTaxSettings(advancedRow as TaxSettings) ?? settings;
    }
  }

  const fetchError =
    ensureError?.message ??
    settingsError?.message ??
    entriesError?.message ??
    autoAdvanceError ??
    null;

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-[#0f2744]">Finance</h1>
      <FinanceNav />
      <h2 className="mb-6 text-xl font-semibold text-[#0f2744]">Statutory Ledger</h2>
      <TaxLedger
        tenantId={tenantId}
        initialSettings={settings}
        initialEntries={entries}
        fetchError={fetchError}
        activeBusinessUnitId={activeBusinessUnitId}
      />
    </div>
  );
}
