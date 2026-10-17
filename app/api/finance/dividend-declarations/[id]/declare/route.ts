import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  dividendDeclarationMatchesActiveBusinessUnit,
  requireDividendsScopedBusinessUnit,
  requireDividendsWrite,
} from "@/lib/finance/dividends-auth";
import { getRetainedEarningsAsOfDate } from "@/lib/finance/dividends-retained-check";
import {
  dividendGrossExceedsRetainedEarningsMessage,
  dividendRpcErrorMessage,
  roundCurrency,
  sumActiveSharePct,
} from "@/lib/finance/dividends-server";
import { fetchTenantShareholders } from "@/lib/finance/dividends-load";
import { createAdminClient } from "@/utils/supabase/admin";
import { createClient } from "@/utils/supabase/server";
import { loadDividendDeclareReadiness } from "@/lib/finance/dividends-declare-readiness";

type DeclareBody = {
  confirm_spec_warnings?: boolean;
};

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireDividendsWrite();
  if (!auth.ok) {
    return auth.response;
  }

  const scoped = await requireDividendsScopedBusinessUnit();
  if (!scoped.ok) {
    return scoped.response;
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const admin = createAdminClient();

  const { data: declaration, error: loadError } = await admin
    .from("dividend_declarations")
    .select("*")
    .eq("tenant_id", auth.tenantId)
    .eq("id", id)
    .maybeSingle();

  if (loadError) {
    return NextResponse.json({ error: loadError.message }, { status: 500 });
  }
  if (!declaration) {
    return NextResponse.json({ error: "Declaration not found." }, { status: 404 });
  }
  if (declaration.status !== "draft") {
    return NextResponse.json(
      { error: "Only draft declarations can be declared." },
      { status: 400 },
    );
  }
  if (
    !dividendDeclarationMatchesActiveBusinessUnit(
      declaration.business_unit_id,
      scoped.businessUnitId,
    )
  ) {
    return NextResponse.json({ error: "Declaration not found." }, { status: 404 });
  }

  if (!declaration.resolution_reference?.trim()) {
    return NextResponse.json(
      { error: "Resolution reference is required before declaring." },
      { status: 400 },
    );
  }
  const periodStart = String(declaration.period_start).slice(0, 10);
  const periodEnd = String(declaration.period_end).slice(0, 10);
  if (!periodStart || !periodEnd || periodEnd < periodStart) {
    return NextResponse.json(
      { error: "Profit period end must be on or after the start date." },
      { status: 400 },
    );
  }

  let body: DeclareBody = {};
  try {
    const text = await request.text();
    if (text.trim()) {
      body = JSON.parse(text) as DeclareBody;
    }
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { rows: shareholders } = await fetchTenantShareholders(admin, auth.tenantId);
  const activeTotal = sumActiveSharePct(shareholders);
  if (Math.abs(activeTotal - 100) > 0.01) {
    return NextResponse.json(
      {
        error: `Active shareholders must total 100% (currently ${activeTotal}%).`,
      },
      { status: 400 },
    );
  }

  const grossAmount = roundCurrency(Number(declaration.gross_amount));
  const { retainedEarnings, error: reError } = await getRetainedEarningsAsOfDate({
    supabase,
    tenantId: auth.tenantId,
    businessUnitId: declaration.business_unit_id,
    asOfDate: declaration.declaration_date,
  });
  if (reError) {
    return NextResponse.json({ error: reError }, { status: 400 });
  }
  if (retainedEarnings !== null && grossAmount > retainedEarnings + 0.005) {
    return NextResponse.json(
      {
        error: dividendGrossExceedsRetainedEarningsMessage(
          grossAmount,
          retainedEarnings,
        ),
      },
      { status: 400 },
    );
  }

  const { warnings, error: readinessError } = await loadDividendDeclareReadiness({
    supabase,
    tenantId: auth.tenantId,
    businessUnitId: declaration.business_unit_id,
    declarationDate: declaration.declaration_date,
    grossAmount,
  });
  if (readinessError) {
    return NextResponse.json({ error: readinessError }, { status: 400 });
  }
  if (warnings.length > 0 && body.confirm_spec_warnings !== true) {
    return NextResponse.json(
      {
        error: "Declaration requires director confirmation.",
        warnings,
        requiresConfirmation: true,
      },
      { status: 409 },
    );
  }

  const { data: taxLedgerEntryId, error: rpcError } = await admin.rpc(
    "declare_dividend_atomic",
    {
      p_tenant_id: auth.tenantId,
      p_declaration_id: id,
      p_declared_by: user.id,
    },
  );

  if (rpcError) {
    return NextResponse.json(
      { error: dividendRpcErrorMessage(rpcError) },
      { status: 400 },
    );
  }

  const { data: refreshed } = await admin
    .from("dividend_declarations")
    .select("*")
    .eq("id", id)
    .single();

  return NextResponse.json({
    declaration: refreshed,
    taxLedgerEntryId: taxLedgerEntryId ?? null,
  });
}
