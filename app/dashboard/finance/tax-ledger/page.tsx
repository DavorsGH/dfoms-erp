import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { getCurrentUserTenantId } from "@/utils/dashboard-auth";
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

  // Upsert-on-first-load (same pattern as billing_settings): ensure one
  // tax_settings row exists for this tenant before the editor mounts.
  const { error: ensureError } = await supabase.from("tax_settings").upsert(
    { tenant_id: tenantId },
    { onConflict: "tenant_id", ignoreDuplicates: true },
  );

  const [
    { data: settingsData, error: settingsError },
    { data: entriesData, error: entriesError },
  ] = await Promise.all([
    supabase
      .from("tax_settings")
      .select(TAX_SETTINGS_FULL_SELECT)
      .eq("tenant_id", tenantId)
      .maybeSingle(),
    supabase
      .from("tax_ledger_entries")
      .select(TAX_LEDGER_SELECT)
      .eq("tenant_id", tenantId)
      .order("entry_date", { ascending: false })
      .order("created_at", { ascending: false }),
  ]);

  const settings =
    normalizeTaxSettings(settingsData as TaxSettings | null) ??
    emptyTaxSettings(tenantId);

  const fetchError =
    ensureError?.message ??
    settingsError?.message ??
    entriesError?.message ??
    null;

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-[#0f2744]">Finance</h1>
      <FinanceNav />
      <h2 className="mb-6 text-xl font-semibold text-[#0f2744]">Statutory Ledger</h2>
      <TaxLedger
        tenantId={tenantId}
        initialSettings={settings}
        initialEntries={
          ((entriesData as TaxLedgerEntry[] | null) ?? []).map(
            normalizeTaxLedgerEntry,
          )
        }
        fetchError={fetchError}
      />
    </div>
  );
}
