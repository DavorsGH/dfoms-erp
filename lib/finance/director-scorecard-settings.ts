import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DIRECTOR_SCORECARD_CIT_RATE,
  DIRECTOR_SCORECARD_DIVIDEND_WHT_RATE,
  DIRECTOR_SCORECARD_GSL_RATE,
  DIRECTOR_SCORECARD_OWNERS_SHARE,
  DIRECTOR_SCORECARD_REINVEST_SHARE,
  DIRECTOR_SCORECARD_RESERVE_SHARE,
  DEFAULT_DIRECTOR_SCORECARD_CIT_RATE_PCT,
  DEFAULT_DIRECTOR_SCORECARD_DIVIDEND_WHT_RATE_PCT,
  DEFAULT_DIRECTOR_SCORECARD_GSL_RATE_PCT,
  DEFAULT_DIRECTOR_SCORECARD_OWNERS_PCT,
  DEFAULT_DIRECTOR_SCORECARD_REINVEST_PCT,
  DEFAULT_DIRECTOR_SCORECARD_RESERVE_PCT,
} from "@/lib/finance/director-scorecard-constants";

export type DirectorScorecardPlanningSettings = {
  citRate: number;
  gslRate: number;
  dividendWhtRate: number;
  reserveShare: number;
  reinvestShare: number;
  ownersShare: number;
};

export type DirectorScorecardSettingsMeta = {
  citRatePct: number;
  gslRatePct: number;
  dividendWhtRatePct: number;
  reservePct: number;
  reinvestPct: number;
  ownersPct: number;
  updatedAt: string | null;
  updatedByDisplayName: string | null;
  isPersisted: boolean;
};

export type TenantScorecardSettingsRow = {
  tenant_id: string;
  cit_rate_pct: number;
  gsl_rate_pct: number;
  dividend_wht_rate_pct: number;
  reserve_pct: number;
  reinvest_pct: number;
  owners_pct: number;
  updated_at: string | null;
  updated_by_auth_uid: string | null;
};

export const TENANT_SCORECARD_SETTINGS_SELECT =
  "tenant_id, cit_rate_pct, gsl_rate_pct, dividend_wht_rate_pct, reserve_pct, reinvest_pct, owners_pct, updated_at, updated_by_auth_uid";

export function defaultDirectorScorecardPlanningSettings(): DirectorScorecardPlanningSettings {
  return {
    citRate: DIRECTOR_SCORECARD_CIT_RATE,
    gslRate: DIRECTOR_SCORECARD_GSL_RATE,
    dividendWhtRate: DIRECTOR_SCORECARD_DIVIDEND_WHT_RATE,
    reserveShare: DIRECTOR_SCORECARD_RESERVE_SHARE,
    reinvestShare: DIRECTOR_SCORECARD_REINVEST_SHARE,
    ownersShare: DIRECTOR_SCORECARD_OWNERS_SHARE,
  };
}

export function defaultDirectorScorecardSettingsMeta(): DirectorScorecardSettingsMeta {
  return {
    citRatePct: DEFAULT_DIRECTOR_SCORECARD_CIT_RATE_PCT,
    gslRatePct: DEFAULT_DIRECTOR_SCORECARD_GSL_RATE_PCT,
    dividendWhtRatePct: DEFAULT_DIRECTOR_SCORECARD_DIVIDEND_WHT_RATE_PCT,
    reservePct: DEFAULT_DIRECTOR_SCORECARD_RESERVE_PCT,
    reinvestPct: DEFAULT_DIRECTOR_SCORECARD_REINVEST_PCT,
    ownersPct: DEFAULT_DIRECTOR_SCORECARD_OWNERS_PCT,
    updatedAt: null,
    updatedByDisplayName: null,
    isPersisted: false,
  };
}

function roundPct(value: number): number {
  return Math.round(value * 100) / 100;
}

function pctToShare(pct: number): number {
  return pct / 100;
}

export function planningSettingsFromPercentages(input: {
  citRatePct: number;
  gslRatePct: number;
  dividendWhtRatePct: number;
  reservePct: number;
  reinvestPct: number;
  ownersPct: number;
}): DirectorScorecardPlanningSettings {
  return {
    citRate: pctToShare(input.citRatePct),
    gslRate: pctToShare(input.gslRatePct),
    dividendWhtRate: pctToShare(input.dividendWhtRatePct),
    reserveShare: pctToShare(input.reservePct),
    reinvestShare: pctToShare(input.reinvestPct),
    ownersShare: pctToShare(input.ownersPct),
  };
}

export function metaFromPercentages(
  input: {
    citRatePct: number;
    gslRatePct: number;
    dividendWhtRatePct: number;
    reservePct: number;
    reinvestPct: number;
    ownersPct: number;
  },
  options: {
    updatedAt: string | null;
    updatedByDisplayName: string | null;
    isPersisted: boolean;
  },
): DirectorScorecardSettingsMeta {
  return {
    citRatePct: roundPct(input.citRatePct),
    gslRatePct: roundPct(input.gslRatePct),
    dividendWhtRatePct: roundPct(input.dividendWhtRatePct),
    reservePct: roundPct(input.reservePct),
    reinvestPct: roundPct(input.reinvestPct),
    ownersPct: roundPct(input.ownersPct),
    updatedAt: options.updatedAt,
    updatedByDisplayName: options.updatedByDisplayName,
    isPersisted: options.isPersisted,
  };
}

function normalizeRatePct(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return roundPct(parsed);
}

export function rowToPlanningAndMeta(
  row: TenantScorecardSettingsRow | null,
  updatedByDisplayName: string | null,
): {
  planning: DirectorScorecardPlanningSettings;
  meta: DirectorScorecardSettingsMeta;
} {
  if (!row) {
    const defaults = defaultDirectorScorecardSettingsMeta();
    return {
      planning: defaultDirectorScorecardPlanningSettings(),
      meta: defaults,
    };
  }

  const citRatePct = normalizeRatePct(
    row.cit_rate_pct,
    DEFAULT_DIRECTOR_SCORECARD_CIT_RATE_PCT,
  );
  const gslRatePct = normalizeRatePct(
    row.gsl_rate_pct,
    DEFAULT_DIRECTOR_SCORECARD_GSL_RATE_PCT,
  );
  const dividendWhtRatePct = normalizeRatePct(
    row.dividend_wht_rate_pct,
    DEFAULT_DIRECTOR_SCORECARD_DIVIDEND_WHT_RATE_PCT,
  );
  const reservePct = normalizeRatePct(
    row.reserve_pct,
    DEFAULT_DIRECTOR_SCORECARD_RESERVE_PCT,
  );
  const reinvestPct = normalizeRatePct(
    row.reinvest_pct,
    DEFAULT_DIRECTOR_SCORECARD_REINVEST_PCT,
  );
  const ownersPct = normalizeRatePct(
    row.owners_pct,
    DEFAULT_DIRECTOR_SCORECARD_OWNERS_PCT,
  );

  const percentages = {
    citRatePct,
    gslRatePct,
    dividendWhtRatePct,
    reservePct,
    reinvestPct,
    ownersPct,
  };

  return {
    planning: planningSettingsFromPercentages(percentages),
    meta: metaFromPercentages(percentages, {
      updatedAt: row.updated_at,
      updatedByDisplayName,
      isPersisted: true,
    }),
  };
}

async function resolveUpdatedByDisplayName(
  admin: SupabaseClient,
  authUid: string | null,
): Promise<string | null> {
  if (!authUid?.trim()) {
    return null;
  }

  const { data } = await admin
    .from("user_accounts")
    .select("email, employees!user_accounts_employee_id_fkey(full_name)")
    .eq("auth_uid", authUid)
    .maybeSingle();

  const employee = data?.employees as { full_name?: string | null } | null;
  const name = employee?.full_name?.trim();
  if (name) {
    return name;
  }
  return data?.email?.trim() || null;
}

export async function loadTenantScorecardSettings(
  supabase: SupabaseClient,
  tenantId: string,
  options?: { adminClient?: SupabaseClient },
): Promise<{
  planning: DirectorScorecardPlanningSettings;
  meta: DirectorScorecardSettingsMeta;
}> {
  // Server routes pass adminClient after auth — session RLS may not SELECT this table.
  const readClient = options?.adminClient ?? supabase;
  const { data: row, error } = await readClient
    .from("tenant_scorecard_settings")
    .select(TENANT_SCORECARD_SETTINGS_SELECT)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  const admin = options?.adminClient;
  const updatedByDisplayName =
    row && admin
      ? await resolveUpdatedByDisplayName(
          admin,
          (row as TenantScorecardSettingsRow).updated_by_auth_uid,
        )
      : null;

  return rowToPlanningAndMeta(
    (row as TenantScorecardSettingsRow | null) ?? null,
    updatedByDisplayName,
  );
}

const RATE_PCT_PATTERN = /^\d{1,3}(\.\d{1,2})?$/;

export type ScorecardSettingsWriteInput = {
  cit_rate_pct: number;
  gsl_rate_pct: number;
  dividend_wht_rate_pct: number;
  reserve_pct: number;
  reinvest_pct: number;
  owners_pct: number;
};

export function validateScorecardSettingsBody(
  body: unknown,
): { ok: true; value: ScorecardSettingsWriteInput } | { ok: false; message: string } {
  if (!body || typeof body !== "object") {
    return { ok: false, message: "Request body is required." };
  }

  const raw = body as Record<string, unknown>;
  const fields: Array<keyof ScorecardSettingsWriteInput> = [
    "cit_rate_pct",
    "gsl_rate_pct",
    "dividend_wht_rate_pct",
    "reserve_pct",
    "reinvest_pct",
    "owners_pct",
  ];

  const parsed: Partial<ScorecardSettingsWriteInput> = {};
  for (const key of fields) {
    const value = raw[key];
    if (typeof value !== "number" && typeof value !== "string") {
      return { ok: false, message: `${key} is required.` };
    }
    const text = String(value).trim();
    if (!RATE_PCT_PATTERN.test(text)) {
      return {
        ok: false,
        message: `${key} must be between 0 and 100 with at most 2 decimal places.`,
      };
    }
    const num = Number(text);
    if (num < 0 || num > 100) {
      return {
        ok: false,
        message: `${key} must be between 0 and 100.`,
      };
    }
    parsed[key] = roundPct(num);
  }

  const splitTotal =
    (parsed.reserve_pct ?? 0) +
    (parsed.reinvest_pct ?? 0) +
    (parsed.owners_pct ?? 0);
  if (Math.abs(splitTotal - 100) > 0.001) {
    return {
      ok: false,
      message: "Reserve, Reinvest, and Owners must total 100%.",
    };
  }

  return { ok: true, value: parsed as ScorecardSettingsWriteInput };
}

export function formatScorecardRatesFooter(meta: DirectorScorecardSettingsMeta): string {
  return `Rates used: CIT ${meta.citRatePct}%, GSL ${meta.gslRatePct}%, dividend WHT ${meta.dividendWhtRatePct}%; profit split ${meta.reservePct}/${meta.reinvestPct}/${meta.ownersPct}.`;
}
