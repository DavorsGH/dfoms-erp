import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { loadTenantScorecardSettings } from "@/lib/finance/director-scorecard-settings";
import {
  dividendDeclarationMatchesActiveBusinessUnit,
  requireDividendsScopedBusinessUnit,
  requireDividendsWrite,
} from "@/lib/finance/dividends-auth";
import {
  buildDividendLinesFromShareholders,
  roundCurrency,
  sumActiveSharePct,
} from "@/lib/finance/dividends-server";
import {
  fetchDividendDeclarationWriteBundle,
  fetchTenantShareholders,
} from "@/lib/finance/dividends-load";
import { responseForDirectorsPostgrestError } from "@/lib/finance/directors-board-api-errors";
import { createAdminClient } from "@/utils/supabase/admin";
import { createClient } from "@/utils/supabase/server";

type PatchBody = {
  declaration_date?: string;
  period_start?: string;
  period_end?: string;
  resolution_reference?: string | null;
  resolution_notes?: string | null;
  gross_amount?: number;
};

export async function PATCH(
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

  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
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
    return responseForDirectorsPostgrestError(loadError, "dividend-declaration-patch-load");
  }
  if (!declaration) {
    return NextResponse.json({ error: "Declaration not found." }, { status: 404 });
  }
  if (declaration.status !== "draft") {
    return NextResponse.json(
      { error: "Only draft declarations can be edited." },
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

  const declarationDate = body.declaration_date?.slice(0, 10) ?? declaration.declaration_date;
  const periodStart = body.period_start?.slice(0, 10) ?? declaration.period_start;
  const periodEnd = body.period_end?.slice(0, 10) ?? declaration.period_end;
  if (periodEnd < periodStart) {
    return NextResponse.json(
      { error: "Profit period end must be on or after the start date." },
      { status: 400 },
    );
  }

  const grossAmount = roundCurrency(
    body.gross_amount != null ? Number(body.gross_amount) : Number(declaration.gross_amount),
  );
  if (!Number.isFinite(grossAmount) || grossAmount <= 0) {
    return NextResponse.json(
      { error: "Gross amount must be greater than zero." },
      { status: 400 },
    );
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const [{ rows: shareholders }, scorecardSettings] = await Promise.all([
    fetchTenantShareholders(admin, auth.tenantId),
    loadTenantScorecardSettings(supabase, auth.tenantId, { adminClient: admin }),
  ]);
  const activeTotal = sumActiveSharePct(shareholders);
  if (Math.abs(activeTotal - 100) > 0.01) {
    return NextResponse.json(
      {
        error: `Active shareholders must total 100% (currently ${activeTotal}%).`,
      },
      { status: 400 },
    );
  }

  const whtRatePct = scorecardSettings.meta.dividendWhtRatePct;
  const { lines, whtAmount, netAmount } = buildDividendLinesFromShareholders({
    shareholders,
    grossAmount,
    whtRatePct,
  });

  const now = new Date().toISOString();
  const { data: updated, error: updateError } = await admin
    .from("dividend_declarations")
    .update({
      declaration_date: declarationDate,
      period_start: periodStart,
      period_end: periodEnd,
      resolution_reference: body.resolution_reference?.trim() || null,
      resolution_notes: body.resolution_notes?.trim() || null,
      gross_amount: grossAmount,
      wht_rate_pct: whtRatePct,
      wht_amount: whtAmount,
      net_amount: netAmount,
      updated_at: now,
    })
    .eq("tenant_id", auth.tenantId)
    .eq("id", id)
    .eq("status", "draft")
    .select()
    .single();

  if (updateError || !updated) {
    if (updateError) {
      return responseForDirectorsPostgrestError(updateError, "dividend-declaration-patch");
    }
    return NextResponse.json({ error: "Could not update draft." }, { status: 500 });
  }

  await admin
    .from("dividend_declaration_lines")
    .delete()
    .eq("tenant_id", auth.tenantId)
    .eq("declaration_id", id);

  const lineRows = lines.map((line) => ({
    tenant_id: auth.tenantId,
    declaration_id: id,
    shareholder_id: line.shareholder_id,
    payee_name: line.payee_name,
    tin: line.tin,
    share_pct: line.share_pct,
    gross_amount: line.gross_amount,
    wht_amount: line.wht_amount,
    net_amount: line.net_amount,
    paid_amount: 0,
    created_at: now,
    updated_at: now,
  }));

  const { error: linesError } = await admin
    .from("dividend_declaration_lines")
    .insert(lineRows);

  if (linesError) {
    return responseForDirectorsPostgrestError(
      linesError,
      "dividend-declaration-lines-patch",
    );
  }

  const bundle = await fetchDividendDeclarationWriteBundle(admin, auth.tenantId, id);
  return NextResponse.json({
    declaration: bundle.declaration ?? updated,
    lines: bundle.lines,
  });
}

export async function DELETE(
  _request: Request,
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

  const { id } = await context.params;
  const admin = createAdminClient();

  const { data: declaration, error: loadError } = await admin
    .from("dividend_declarations")
    .select("id, status, business_unit_id")
    .eq("tenant_id", auth.tenantId)
    .eq("id", id)
    .maybeSingle();

  if (loadError) {
    return responseForDirectorsPostgrestError(loadError, "dividend-declaration-delete-load");
  }
  if (!declaration) {
    return NextResponse.json({ error: "Declaration not found." }, { status: 404 });
  }
  if (declaration.status !== "draft") {
    return NextResponse.json(
      { error: "Only draft declarations can be deleted." },
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

  await admin
    .from("dividend_declaration_lines")
    .delete()
    .eq("tenant_id", auth.tenantId)
    .eq("declaration_id", id);

  const { error: deleteError } = await admin
    .from("dividend_declarations")
    .delete()
    .eq("tenant_id", auth.tenantId)
    .eq("id", id);

  if (deleteError) {
    return responseForDirectorsPostgrestError(deleteError, "dividend-declaration-delete");
  }

  return NextResponse.json({ ok: true });
}
