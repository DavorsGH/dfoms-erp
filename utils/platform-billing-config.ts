import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/** Config key for platform_only per-unit activation / monthly metered price (GHS). */
export const PLATFORM_ONLY_UNIT_ACTIVATION_CONFIG_KEY =
  "platform_only_unit_activation" as const;

/** Config key for platform_only per-unit annual recurring price (GHS). */
export const PLATFORM_ONLY_UNIT_ANNUAL_CONFIG_KEY =
  "platform_only_unit_annual" as const;

/** Fallback when DB row is missing (pre-migration or read failure). */
export const DEFAULT_PLATFORM_ONLY_UNIT_ACTIVATION_PRICE_GHS = 110;

/** Fallback annual per-unit rate when DB row is missing. */
export const DEFAULT_PLATFORM_ONLY_UNIT_ANNUAL_PRICE_GHS = 1100;

type PlatformBillingConfigRow = {
  config_key: string;
  price_ghs: number | string;
  updated_at: string;
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
