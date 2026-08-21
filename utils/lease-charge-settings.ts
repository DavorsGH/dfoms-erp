import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createDefaultLeaseChargeSettings,
  isLeaseChargeBillingMode,
  isLeaseChargeCategory,
  mergeLeaseChargeSettings,
  type LeaseChargeBillingMode,
  type LeaseChargeCategory,
  type LeaseChargeSettingRow,
} from "@/utils/lease-charge-categories";

type SettingsDbRow = {
  charge_category: string;
  is_billed: boolean;
  billing_mode: string;
  flat_amount_ghs: number | string | null;
};

function toNumber(value: number | string | null | undefined): number | null {
  if (value == null || value === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function mapSettingsRow(row: SettingsDbRow): LeaseChargeSettingRow | null {
  if (!isLeaseChargeCategory(row.charge_category)) {
    return null;
  }
  if (!isLeaseChargeBillingMode(row.billing_mode)) {
    return null;
  }
  return {
    chargeCategory: row.charge_category,
    isBilled: row.is_billed === true,
    billingMode: row.billing_mode,
    flatAmountGhs: toNumber(row.flat_amount_ghs),
  };
}

export async function fetchLeaseChargeSettings(
  admin: SupabaseClient,
  leaseId: string,
): Promise<{ settings: LeaseChargeSettingRow[]; fetchError: string | null }> {
  const trimmedLeaseId = leaseId.trim();
  if (!trimmedLeaseId) {
    return { settings: createDefaultLeaseChargeSettings(), fetchError: null };
  }

  const { data, error } = await admin
    .from("lease_charge_settings")
    .select("charge_category, is_billed, billing_mode, flat_amount_ghs")
    .eq("lease_id", trimmedLeaseId);

  if (error) {
    return { settings: createDefaultLeaseChargeSettings(), fetchError: error.message };
  }

  const saved = ((data as SettingsDbRow[] | null) ?? [])
    .map(mapSettingsRow)
    .filter((row): row is LeaseChargeSettingRow => row != null);

  return {
    settings: mergeLeaseChargeSettings(saved),
    fetchError: null,
  };
}

export type UpsertLeaseChargeSettingInput = {
  chargeCategory: LeaseChargeCategory;
  isBilled: boolean;
  billingMode: LeaseChargeBillingMode;
  flatAmountGhs: number | null;
};

function validateSettingInput(
  input: UpsertLeaseChargeSettingInput,
): string | null {
  if (!isLeaseChargeCategory(input.chargeCategory)) {
    return "Invalid charge category.";
  }
  if (!isLeaseChargeBillingMode(input.billingMode)) {
    return "Invalid billing mode.";
  }
  if (!input.isBilled) {
    return null;
  }
  if (input.billingMode === "recurring") {
    const amount = input.flatAmountGhs;
    if (amount == null || !Number.isFinite(amount) || amount <= 0) {
      return "Recurring billed categories require a positive flat amount.";
    }
  }
  return null;
}

export async function upsertLeaseChargeSettings(
  admin: SupabaseClient,
  options: {
    tenantId: string;
    leaseId: string;
    settings: UpsertLeaseChargeSettingInput[];
  },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const leaseId = options.leaseId.trim();
  if (!leaseId) {
    return { ok: false, error: "lease_id is required." };
  }

  const { data: lease, error: leaseError } = await admin
    .from("leases")
    .select("lease_id, tenant_id, status")
    .eq("tenant_id", options.tenantId)
    .eq("lease_id", leaseId)
    .maybeSingle();

  if (leaseError) {
    return { ok: false, error: leaseError.message };
  }
  if (!lease) {
    return { ok: false, error: "Lease not found." };
  }

  const nowIso = new Date().toISOString();
  for (const setting of options.settings) {
    const validationError = validateSettingInput(setting);
    if (validationError) {
      return { ok: false, error: validationError };
    }

    const flatAmount =
      setting.isBilled &&
      setting.billingMode === "recurring" &&
      setting.flatAmountGhs != null
        ? Math.round((setting.flatAmountGhs + Number.EPSILON) * 100) / 100
        : null;

    const { error: upsertError } = await admin.from("lease_charge_settings").upsert(
      {
        tenant_id: options.tenantId,
        lease_id: leaseId,
        charge_category: setting.chargeCategory,
        is_billed: setting.isBilled,
        billing_mode: setting.billingMode,
        flat_amount_ghs: flatAmount,
        updated_at: nowIso,
      },
      { onConflict: "lease_id,charge_category" },
    );

    if (upsertError) {
      return { ok: false, error: upsertError.message };
    }
  }

  return { ok: true };
}
