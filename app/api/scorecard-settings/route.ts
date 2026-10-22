import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  loadTenantScorecardSettings,
  metaFromPercentages,
  validateScorecardSettingsBody,
} from "@/lib/finance/director-scorecard-settings";
import {
  clientMessageForDirectorsLoadError,
  responseForDirectorsPostgrestError,
} from "@/lib/finance/directors-board-api-errors";
import { requireTenantRoleIn } from "@/utils/admin-auth";
import { createAdminClient } from "@/utils/supabase/admin";
import { createClient } from "@/utils/supabase/server";

const SCORECARD_SETTINGS_ROLES = ["director", "super_admin"] as const;

export async function GET() {
  const auth = await requireTenantRoleIn(SCORECARD_SETTINGS_ROLES);
  if (!auth.ok) {
    return auth.response;
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  try {
    const { meta } = await loadTenantScorecardSettings(supabase, auth.tenantId, {
      adminClient: createAdminClient(),
    });
    return NextResponse.json({ settings: meta });
  } catch (error) {
    const raw =
      error instanceof Error ? error.message : "Unable to load scorecard settings.";
    return NextResponse.json(
      {
        error: clientMessageForDirectorsLoadError(raw, "scorecard-settings-get"),
      },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request) {
  const auth = await requireTenantRoleIn(SCORECARD_SETTINGS_ROLES);
  if (!auth.ok) {
    return auth.response;
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const validated = validateScorecardSettingsBody(body);
  if (!validated.ok) {
    return NextResponse.json({ error: validated.message }, { status: 400 });
  }

  const admin = createAdminClient();
  const now = new Date().toISOString();
  const { error: upsertError } = await admin.from("tenant_scorecard_settings").upsert(
    {
      tenant_id: auth.tenantId,
      cit_rate_pct: validated.value.cit_rate_pct,
      gsl_rate_pct: validated.value.gsl_rate_pct,
      dividend_wht_rate_pct: validated.value.dividend_wht_rate_pct,
      reserve_pct: validated.value.reserve_pct,
      reinvest_pct: validated.value.reinvest_pct,
      owners_pct: validated.value.owners_pct,
      updated_at: now,
      updated_by_auth_uid: user.id,
    },
    { onConflict: "tenant_id" },
  );

  if (upsertError) {
    return responseForDirectorsPostgrestError(upsertError, "scorecard-settings-put");
  }

  const { data: account } = await admin
    .from("user_accounts")
    .select("email, employees!user_accounts_employee_id_fkey(full_name)")
    .eq("auth_uid", user.id)
    .maybeSingle();
  const employee = account?.employees as { full_name?: string | null } | null;
  const updatedByDisplayName =
    employee?.full_name?.trim() || account?.email?.trim() || null;

  const settings = metaFromPercentages(
    {
      citRatePct: validated.value.cit_rate_pct,
      gslRatePct: validated.value.gsl_rate_pct,
      dividendWhtRatePct: validated.value.dividend_wht_rate_pct,
      reservePct: validated.value.reserve_pct,
      reinvestPct: validated.value.reinvest_pct,
      ownersPct: validated.value.owners_pct,
    },
    {
      updatedAt: now,
      updatedByDisplayName,
      isPersisted: true,
    },
  );

  return NextResponse.json({ settings });
}

export async function POST(request: Request) {
  return PUT(request);
}
