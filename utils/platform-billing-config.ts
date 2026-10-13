import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { logSystemEvent } from "@/lib/system-event-log";
import { resolveTenantPrimaryBusinessUnitId } from "@/utils/business-units-server";
import { DAVORS_TENANT_ID } from "@/utils/tenant-signup";

/** Config key for platform_only per-unit activation / monthly metered price (GHS). */
export const PLATFORM_ONLY_UNIT_ACTIVATION_CONFIG_KEY =
  "platform_only_unit_activation" as const;

/** Config key for platform_only per-unit annual recurring price (GHS). */
export const PLATFORM_ONLY_UNIT_ANNUAL_CONFIG_KEY =
  "platform_only_unit_annual" as const;

/** Config key for max billable active units per platform_only landlord. */
export const PLATFORM_ONLY_UNIT_CAP_CONFIG_KEY =
  "platform_only_unit_cap" as const;

/** Config key for ERP referral reward amount (GHS). */
export const REFERRAL_REWARD_GHS_CONFIG_KEY = "referral_reward_ghs" as const;

/** Config key for Davors business unit receiving platform billing finance postings. */
export const PLATFORM_BILLING_BUSINESS_UNIT_CONFIG_KEY =
  "platform_billing_business_unit" as const;

/** Fallback when DB row is missing (pre-migration or read failure). */
export const DEFAULT_PLATFORM_ONLY_UNIT_ACTIVATION_PRICE_GHS = 110;

/** Fallback annual per-unit rate when DB row is missing. */
export const DEFAULT_PLATFORM_ONLY_UNIT_ANNUAL_PRICE_GHS = 1100;

/** Fallback active-unit cap when DB row is missing. */
export const DEFAULT_PLATFORM_ONLY_UNIT_CAP = 25;

type PlatformBillingConfigRow = {
  config_key: string;
  price_ghs: number | string;
  updated_at: string;
  business_unit_id?: string | null;
};

export type PlatformBillingBusinessUnitConfig = {
  configKey: typeof PLATFORM_BILLING_BUSINESS_UNIT_CONFIG_KEY;
  businessUnitId: string | null;
  updatedAt: string | null;
};

export type PlatformOnlyUnitActivationPricing = {
  configKey: typeof PLATFORM_ONLY_UNIT_ACTIVATION_CONFIG_KEY;
  priceGhs: number;
  updatedAt: string | null;
};

export type PlatformOnlyUnitAnnualPricing = {
  configKey: typeof PLATFORM_ONLY_UNIT_ANNUAL_CONFIG_KEY;
  priceGhs: number;
  updatedAt: string | null;
};

export type PlatformOnlyUnitCapConfig = {
  configKey: typeof PLATFORM_ONLY_UNIT_CAP_CONFIG_KEY;
  unitCap: number;
  updatedAt: string | null;
};

export type ReferralRewardGhsConfig = {
  configKey: typeof REFERRAL_REWARD_GHS_CONFIG_KEY;
  rewardGhs: number;
  updatedAt: string | null;
};

function parsePriceGhs(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
}

export async function getPlatformOnlyUnitActivationPriceGhs(
  admin: SupabaseClient,
): Promise<number> {
  const pricing = await getPlatformOnlyUnitActivationPricing(admin);
  return pricing.priceGhs;
}

export async function getPlatformOnlyUnitActivationPricing(
  admin: SupabaseClient,
): Promise<PlatformOnlyUnitActivationPricing> {
  const { data, error } = await admin
    .from("platform_billing_config")
    .select("config_key, price_ghs, updated_at")
    .eq("config_key", PLATFORM_ONLY_UNIT_ACTIVATION_CONFIG_KEY)
    .maybeSingle();

  if (error) {
    console.warn(
      "[platform-billing-config] read failed — using default price:",
      error.message,
    );
    return {
      configKey: PLATFORM_ONLY_UNIT_ACTIVATION_CONFIG_KEY,
      priceGhs: DEFAULT_PLATFORM_ONLY_UNIT_ACTIVATION_PRICE_GHS,
      updatedAt: null,
    };
  }

  const row = data as PlatformBillingConfigRow | null;
  const priceGhs = parsePriceGhs(row?.price_ghs);
  if (priceGhs === null) {
    return {
      configKey: PLATFORM_ONLY_UNIT_ACTIVATION_CONFIG_KEY,
      priceGhs: DEFAULT_PLATFORM_ONLY_UNIT_ACTIVATION_PRICE_GHS,
      updatedAt: row?.updated_at ?? null,
    };
  }

  return {
    configKey: PLATFORM_ONLY_UNIT_ACTIVATION_CONFIG_KEY,
    priceGhs,
    updatedAt: row?.updated_at ?? null,
  };
}

export async function updatePlatformOnlyUnitActivationPriceGhs(
  admin: SupabaseClient,
  priceGhs: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!Number.isFinite(priceGhs) || priceGhs < 0) {
    return { ok: false, error: "price_ghs must be a non-negative number." };
  }

  const now = new Date().toISOString();
  const { error } = await admin.from("platform_billing_config").upsert(
    {
      config_key: PLATFORM_ONLY_UNIT_ACTIVATION_CONFIG_KEY,
      price_ghs: priceGhs,
      updated_at: now,
    },
    { onConflict: "config_key" },
  );

  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true };
}

export async function getPlatformOnlyUnitAnnualPriceGhs(
  admin: SupabaseClient,
): Promise<number> {
  const pricing = await getPlatformOnlyUnitAnnualPricing(admin);
  return pricing.priceGhs;
}

export async function getPlatformOnlyUnitAnnualPricing(
  admin: SupabaseClient,
): Promise<PlatformOnlyUnitAnnualPricing> {
  const { data, error } = await admin
    .from("platform_billing_config")
    .select("config_key, price_ghs, updated_at")
    .eq("config_key", PLATFORM_ONLY_UNIT_ANNUAL_CONFIG_KEY)
    .maybeSingle();

  if (error) {
    console.warn(
      "[platform-billing-config] annual read failed — using default price:",
      error.message,
    );
    return {
      configKey: PLATFORM_ONLY_UNIT_ANNUAL_CONFIG_KEY,
      priceGhs: DEFAULT_PLATFORM_ONLY_UNIT_ANNUAL_PRICE_GHS,
      updatedAt: null,
    };
  }

  const row = data as PlatformBillingConfigRow | null;
  const priceGhs = parsePriceGhs(row?.price_ghs);
  if (priceGhs === null) {
    return {
      configKey: PLATFORM_ONLY_UNIT_ANNUAL_CONFIG_KEY,
      priceGhs: DEFAULT_PLATFORM_ONLY_UNIT_ANNUAL_PRICE_GHS,
      updatedAt: row?.updated_at ?? null,
    };
  }

  return {
    configKey: PLATFORM_ONLY_UNIT_ANNUAL_CONFIG_KEY,
    priceGhs,
    updatedAt: row?.updated_at ?? null,
  };
}

export async function updatePlatformOnlyUnitAnnualPriceGhs(
  admin: SupabaseClient,
  priceGhs: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!Number.isFinite(priceGhs) || priceGhs < 0) {
    return { ok: false, error: "price_ghs must be a non-negative number." };
  }

  const now = new Date().toISOString();
  const { error } = await admin.from("platform_billing_config").upsert(
    {
      config_key: PLATFORM_ONLY_UNIT_ANNUAL_CONFIG_KEY,
      price_ghs: priceGhs,
      updated_at: now,
    },
    { onConflict: "config_key" },
  );

  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true };
}

function parseUnitCap(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || !Number.isInteger(parsed)) {
    return null;
  }
  return parsed;
}

export async function getPlatformOnlyUnitCap(
  admin: SupabaseClient,
): Promise<number> {
  const config = await getPlatformOnlyUnitCapConfig(admin);
  return config.unitCap;
}

export async function getPlatformOnlyUnitCapConfig(
  admin: SupabaseClient,
): Promise<PlatformOnlyUnitCapConfig> {
  const { data, error } = await admin
    .from("platform_billing_config")
    .select("config_key, price_ghs, updated_at")
    .eq("config_key", PLATFORM_ONLY_UNIT_CAP_CONFIG_KEY)
    .maybeSingle();

  if (error) {
    console.warn(
      "[platform-billing-config] unit cap read failed — using default:",
      error.message,
    );
    return {
      configKey: PLATFORM_ONLY_UNIT_CAP_CONFIG_KEY,
      unitCap: DEFAULT_PLATFORM_ONLY_UNIT_CAP,
      updatedAt: null,
    };
  }

  const row = data as PlatformBillingConfigRow | null;
  const unitCap = parseUnitCap(row?.price_ghs);
  if (unitCap === null) {
    return {
      configKey: PLATFORM_ONLY_UNIT_CAP_CONFIG_KEY,
      unitCap: DEFAULT_PLATFORM_ONLY_UNIT_CAP,
      updatedAt: row?.updated_at ?? null,
    };
  }

  return {
    configKey: PLATFORM_ONLY_UNIT_CAP_CONFIG_KEY,
    unitCap,
    updatedAt: row?.updated_at ?? null,
  };
}

export async function updatePlatformOnlyUnitCap(
  admin: SupabaseClient,
  unitCap: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!Number.isFinite(unitCap) || unitCap < 0 || !Number.isInteger(unitCap)) {
    return {
      ok: false,
      error: "unit_cap must be a non-negative whole number.",
    };
  }

  const now = new Date().toISOString();
  const { error } = await admin.from("platform_billing_config").upsert(
    {
      config_key: PLATFORM_ONLY_UNIT_CAP_CONFIG_KEY,
      price_ghs: unitCap,
      updated_at: now,
    },
    { onConflict: "config_key" },
  );

  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true };
}

export async function getReferralRewardGhsConfig(
  admin: SupabaseClient,
): Promise<ReferralRewardGhsConfig> {
  const { data, error } = await admin
    .from("platform_billing_config")
    .select("config_key, price_ghs, updated_at")
    .eq("config_key", REFERRAL_REWARD_GHS_CONFIG_KEY)
    .maybeSingle();

  if (error) {
    throw new Error(
      `[platform-billing-config] referral reward read failed: ${error.message}`,
    );
  }

  const row = data as PlatformBillingConfigRow | null;
  const rewardGhs = parsePriceGhs(row?.price_ghs);
  if (rewardGhs === null) {
    throw new Error(
      "[platform-billing-config] referral_reward_ghs row is missing or invalid.",
    );
  }

  return {
    configKey: REFERRAL_REWARD_GHS_CONFIG_KEY,
    rewardGhs,
    updatedAt: row?.updated_at ?? null,
  };
}

export async function getReferralRewardGhs(
  admin: SupabaseClient,
): Promise<number> {
  const config = await getReferralRewardGhsConfig(admin);
  return config.rewardGhs;
}

export async function updateReferralRewardGhs(
  admin: SupabaseClient,
  rewardGhs: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!Number.isFinite(rewardGhs) || rewardGhs < 0) {
    return { ok: false, error: "reward_ghs must be a non-negative number." };
  }

  const now = new Date().toISOString();
  const { error } = await admin.from("platform_billing_config").upsert(
    {
      config_key: REFERRAL_REWARD_GHS_CONFIG_KEY,
      price_ghs: rewardGhs,
      updated_at: now,
    },
    { onConflict: "config_key" },
  );

  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true };
}

function parseBusinessUnitId(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function isActiveDavorsBusinessUnit(
  admin: SupabaseClient,
  businessUnitId: string,
): Promise<boolean> {
  const { data, error } = await admin
    .from("business_units")
    .select("id")
    .eq("id", businessUnitId)
    .eq("tenant_id", DAVORS_TENANT_ID)
    .eq("is_active", true)
    .maybeSingle();

  if (error) {
    throw new Error(
      `[platform-billing-config] business unit validation failed: ${error.message}`,
    );
  }

  return Boolean(data?.id);
}

export async function getPlatformBillingBusinessUnitConfig(
  admin: SupabaseClient,
): Promise<PlatformBillingBusinessUnitConfig> {
  const { data, error } = await admin
    .from("platform_billing_config")
    .select("config_key, business_unit_id, updated_at")
    .eq("config_key", PLATFORM_BILLING_BUSINESS_UNIT_CONFIG_KEY)
    .maybeSingle();

  if (error) {
    console.warn(
      "[platform-billing-config] platform billing BU read failed:",
      error.message,
    );
    return {
      configKey: PLATFORM_BILLING_BUSINESS_UNIT_CONFIG_KEY,
      businessUnitId: null,
      updatedAt: null,
    };
  }

  const row = data as PlatformBillingConfigRow | null;
  return {
    configKey: PLATFORM_BILLING_BUSINESS_UNIT_CONFIG_KEY,
    businessUnitId: parseBusinessUnitId(row?.business_unit_id),
    updatedAt: row?.updated_at ?? null,
  };
}

/**
 * Business unit for platform billing income and related Paystack fee expenses.
 * Falls back to Davors primary BU and logs a warning when config is missing/invalid.
 */
export async function resolvePlatformBillingBusinessUnitId(
  admin: SupabaseClient,
): Promise<string | null> {
  const config = await getPlatformBillingBusinessUnitConfig(admin);
  const configuredId = config.businessUnitId;

  if (configuredId && (await isActiveDavorsBusinessUnit(admin, configuredId))) {
    return configuredId;
  }

  const primaryId = await resolveTenantPrimaryBusinessUnitId(
    admin,
    DAVORS_TENANT_ID,
  );

  if (primaryId) {
    void logSystemEvent({
      eventType: "payment",
      eventName: "platform_billing_business_unit_fallback",
      status: "warning",
      message:
        configuredId == null
          ? "Platform billing business unit setting is missing; using Davors primary business unit."
          : "Platform billing business unit setting is invalid or inactive; using Davors primary business unit.",
      metadata: {
        configured_business_unit_id: configuredId,
        fallback_business_unit_id: primaryId,
      },
    });
    return primaryId;
  }

  void logSystemEvent({
    eventType: "payment",
    eventName: "platform_billing_business_unit_fallback",
    status: "warning",
    message:
      "Platform billing business unit could not be resolved (no valid setting or primary business unit).",
    metadata: {
      configured_business_unit_id: configuredId,
    },
  });

  return null;
}

export async function updatePlatformBillingBusinessUnitId(
  admin: SupabaseClient,
  businessUnitId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const id = businessUnitId.trim();
  if (!id) {
    return { ok: false, error: "business_unit_id is required." };
  }

  if (!(await isActiveDavorsBusinessUnit(admin, id))) {
    return {
      ok: false,
      error: "Choose an active business unit in the Davors workspace.",
    };
  }

  const now = new Date().toISOString();
  const { error } = await admin.from("platform_billing_config").upsert(
    {
      config_key: PLATFORM_BILLING_BUSINESS_UNIT_CONFIG_KEY,
      price_ghs: 0,
      business_unit_id: id,
      updated_at: now,
    },
    { onConflict: "config_key" },
  );

  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true };
}
