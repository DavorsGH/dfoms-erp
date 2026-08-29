import { cookies } from "next/headers";

import { createClient } from "@/utils/supabase/server";
import { getActiveBusinessUnitId } from "@/utils/dashboard-auth";
import { scopeTaxSettingsRead } from "@/utils/phase5e-key-structure";

import { CLIENT_SELECT, type ClientEntry } from "../operations/clients-utils";

import type { ServiceType } from "../service-types";

import FinanceNav from "./finance-nav";

import IncomeRegister from "./income-register";

import {
  normalizeIncomeRegisterEntry,
  SERVICE_INCOME_REGISTER_SELECT,
  type IncomeRegisterEntry,
} from "./income-register-utils";

import {
  normalizeTaxRateCatalogEntry,
  normalizeTaxSettings,
  TAX_RATE_CATALOG_SELECT,
  TAX_SETTINGS_SELECT,
  type TaxRateCatalogEntry,
  type TaxSettings,
} from "./tax-utils";

export default async function FinancePage() {
  const cookieStore = await cookies();

  const supabase = createClient(cookieStore);
  const activeBusinessUnitId = await getActiveBusinessUnitId();

  const [
    { data, error },
    { data: serviceTypes, error: serviceTypesError },
    { data: clients, error: clientsError },
    { data: taxSettings, error: taxSettingsError },
    { data: taxRateCatalog, error: taxRateCatalogError },
  ] = await Promise.all([
    supabase
      .from("income_register")
      .select(SERVICE_INCOME_REGISTER_SELECT)
      .or("entry_type.eq.service,entry_type.is.null")
      .order("date", { ascending: false }),

    supabase.from("service_types").select("name").order("name", { ascending: true }),

    supabase.from("customers").select(CLIENT_SELECT).order("client_name", { ascending: true }),

    scopeTaxSettingsRead(
      supabase.from("tax_settings").select(TAX_SETTINGS_SELECT),
      activeBusinessUnitId,
    ).maybeSingle(),

    // Tenant overrides plus system defaults (tenant_id IS NULL), per the read policy.
    supabase
      .from("tax_rate_catalog")
      .select(TAX_RATE_CATALOG_SELECT)
      .eq("is_active", true)
      .order("sort_order", { ascending: true }),
  ]);

  const fetchError =
    error?.message ??
    serviceTypesError?.message ??
    clientsError?.message ??
    taxSettingsError?.message ??
    taxRateCatalogError?.message ??
    null;

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-[#0f2744]">Finance</h1>

      <FinanceNav />

      <h2 className="mb-6 text-xl font-semibold text-[#0f2744]">
        Income Register
      </h2>

      <IncomeRegister
        initialEntries={
          (data as IncomeRegisterEntry[] | null)?.map((entry) =>
            normalizeIncomeRegisterEntry(entry),
          ) ?? []
        }
        initialServiceTypes={(serviceTypes as ServiceType[] | null) ?? []}
        initialClients={(clients as ClientEntry[] | null) ?? []}
        taxSettings={normalizeTaxSettings(taxSettings as TaxSettings | null)}
        taxRateCatalog={
          (taxRateCatalog as TaxRateCatalogEntry[] | null)?.map((entry) =>
            normalizeTaxRateCatalogEntry(entry),
          ) ?? []
        }
        fetchError={fetchError}
        activeBusinessUnitId={activeBusinessUnitId}
      />
    </div>
  );
}
