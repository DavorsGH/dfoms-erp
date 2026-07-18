import type { SupabaseClient } from "@supabase/supabase-js";
import { SERVICE_INCOME_REGISTER_SELECT } from "./finance/income-register-utils";
import type { InspectionSummaryEntry } from "./operations/inspection-summary-utils";

export type ClientDashboardSummary = {
  clientName: string;
  outstandingBalance: number;
  invoiceCount: number;
  siteCount: number;
  inspectionsThisMonth: number;
  passedInspectionsThisMonth: number;
  periodLabel: string;
};

function currentMonthBounds() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const start = new Date(year, month, 1);
  const end = new Date(year, month + 1, 0);
  const periodLabel = start.toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
  });

  return {
    periodLabel,
    startIso: start.toISOString().slice(0, 10),
    endIso: end.toISOString().slice(0, 10),
  };
}

function isPassResult(passFail: string | null | undefined): boolean {
  const normalized = (passFail ?? "").trim().toLowerCase();
  return normalized === "pass" || normalized === "passed";
}

export async function buildClientDashboardSummary(
  supabase: SupabaseClient,
  clientId: string,
): Promise<{ summary: ClientDashboardSummary | null; fetchError: string | null }> {
  const { periodLabel, startIso, endIso } = currentMonthBounds();

  const [
    { data: client, error: clientError },
    { data: invoices, error: invoiceError },
    { data: sites, error: sitesError },
    { data: inspections, error: inspectionsError },
  ] = await Promise.all([
    supabase
      .from("customers")
      .select("client_id, client_name")
      .eq("client_id", clientId)
      .maybeSingle(),
    supabase
      .from("income_register")
      .select(SERVICE_INCOME_REGISTER_SELECT)
      .eq("entry_type", "service"),
    supabase.from("sites").select("site_code").eq("client_id", clientId),
    supabase
      .from("inspection_summary")
      .select("inspection_date, pass_fail, client_id")
      .eq("client_id", clientId)
      .gte("inspection_date", startIso)
      .lte("inspection_date", endIso),
  ]);

  const fetchError =
    clientError?.message ??
    invoiceError?.message ??
    sitesError?.message ??
    inspectionsError?.message ??
    null;

  if (!client) {
    return { summary: null, fetchError: fetchError ?? "Client record not found." };
  }

  const invoiceRows = invoices ?? [];
  const inspectionRows = (inspections as InspectionSummaryEntry[] | null) ?? [];
  const passedInspectionsThisMonth = inspectionRows.filter((entry) =>
    isPassResult(entry.pass_fail),
  ).length;

  return {
    summary: {
      clientName: client.client_name,
      outstandingBalance: invoiceRows.reduce(
        (sum, entry) => sum + (Number(entry.outstanding_balance) || 0),
        0,
      ),
      invoiceCount: invoiceRows.length,
      siteCount: sites?.length ?? 0,
      inspectionsThisMonth: inspectionRows.length,
      passedInspectionsThisMonth,
      periodLabel,
    },
    fetchError,
  };
}
