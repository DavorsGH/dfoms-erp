import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  dividendDeclarationMatchesActiveBusinessUnit,
  requireDividendsScopedBusinessUnit,
  requireDividendsWrite,
} from "@/lib/finance/dividends-auth";
import { getRetainedEarningsAsOfDate } from "@/lib/finance/dividends-retained-check";
import { loadDividendDeclareReadiness } from "@/lib/finance/dividends-declare-readiness";
import {
  dividendGrossExceedsRetainedEarningsMessage,
  roundCurrency,
} from "@/lib/finance/dividends-server";
import { responseForDirectorsPostgrestError } from "@/lib/finance/directors-board-api-errors";
import { createAdminClient } from "@/utils/supabase/admin";
import { createClient } from "@/utils/supabase/server";

export async function GET(
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
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data: declaration, error: loadError } = await admin
    .from("dividend_declarations")
    .select("id, status, declaration_date, business_unit_id, gross_amount")
    .eq("tenant_id", auth.tenantId)
    .eq("id", id)
    .maybeSingle();

  if (loadError) {
    return responseForDirectorsPostgrestError(loadError, "dividend-declare-readiness-load");
  }
  if (!declaration) {
    return NextResponse.json({ error: "Declaration not found." }, { status: 404 });
  }
  if (declaration.status !== "draft") {
    return NextResponse.json(
      { error: "Readiness applies to draft declarations only." },
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

  const { warnings, error } = await loadDividendDeclareReadiness({
    supabase,
    tenantId: auth.tenantId,
    businessUnitId: declaration.business_unit_id,
    declarationDate: declaration.declaration_date,
    grossAmount,
  });

  if (error) {
    return NextResponse.json({ error }, { status: 400 });
  }

  return NextResponse.json({ warnings, requiresConfirmation: warnings.length > 0 });
}
