import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { loadTenantScorecardSettings } from "@/lib/finance/director-scorecard-settings";
import {
  requireDividendsRead,
  requireDividendsScopedBusinessUnit,
  requireDividendsWrite,
} from "@/lib/finance/dividends-auth";
import {
  allocateDividendNumber,
  buildDividendLinesFromShareholders,
  roundCurrency,
  sumActiveSharePct,
} from "@/lib/finance/dividends-server";
import {
  fetchDividendDeclarationLines,
  fetchDividendDeclarations,
  fetchTenantShareholders,
} from "@/lib/finance/dividends-load";
import { getViewAllBusinessUnits } from "@/utils/dashboard-auth";
import { createAdminClient } from "@/utils/supabase/admin";
import { createClient } from "@/utils/supabase/server";

type DeclarationBody = {
  tenant_id?: string;
  declaration_date?: string;
  period_start?: string;
  period_end?: string;
  resolution_reference?: string | null;
  resolution_notes?: string | null;
  gross_amount?: number;
};

function priorCompletedQuarterBounds(isoDate: string): {
  periodStart: string;
  periodEnd: string;
} {
  const ref = new Date(`${isoDate.slice(0, 10)}T12:00:00`);
  const month = ref.getMonth();
  const quarterStartMonth = Math.floor(month / 3) * 3;
  const start = new Date(ref.getFullYear(), quarterStartMonth - 3, 1);
  const end = new Date(ref.getFullYear(), quarterStartMonth, 0);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { periodStart: iso(start), periodEnd: iso(end) };
}

export async function GET() {
  const auth = await requireDividendsRead();
  if (!auth.ok) {
    return auth.response;
  }

  const viewAll = await getViewAllBusinessUnits();
  if (viewAll) {
    return NextResponse.json({ declarations: [], lines: [] });
  }

  const scoped = await requireDividendsScopedBusinessUnit();
  if (!scoped.ok) {
    return scoped.response;
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const declarationsResult = await fetchDividendDeclarations(
    supabase,
    auth.tenantId,
    { businessUnitId: scoped.businessUnitId },
  );
  if (declarationsResult.error) {
    return NextResponse.json({ error: declarationsResult.error }, { status: 500 });
  }

  const declarationIds = declarationsResult.rows.map((row) => row.id);
  const linesResult = await fetchDividendDeclarationLines(
    supabase,
    auth.tenantId,
    declarationIds,
  );
  if (linesResult.error) {
    return NextResponse.json({ error: linesResult.error }, { status: 500 });
  }

  return NextResponse.json({
    declarations: declarationsResult.rows,
    lines: linesResult.rows,
  });
}

export async function POST(request: Request) {
  const auth = await requireDividendsWrite();
  if (!auth.ok) {
    return auth.response;
  }

  const scoped = await requireDividendsScopedBusinessUnit();
  if (!scoped.ok) {
    return scoped.response;
  }

  let body: DeclarationBody;
  try {
    body = (await request.json()) as DeclarationBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const grossAmount = roundCurrency(Number(body.gross_amount));
  if (!Number.isFinite(grossAmount) || grossAmount <= 0) {
    return NextResponse.json(
      { error: "Gross amount must be greater than zero." },
      { status: 400 },
    );
  }

  const declarationDate = body.declaration_date?.slice(0, 10);
  if (!declarationDate) {
    return NextResponse.json({ error: "Declaration date is required." }, { status: 400 });
  }

  const quarter = priorCompletedQuarterBounds(declarationDate);
  const periodStart = body.period_start?.slice(0, 10) ?? quarter.periodStart;
  const periodEnd = body.period_end?.slice(0, 10) ?? quarter.periodEnd;

  const admin = createAdminClient();
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

  const { number: declarationNumber, error: numberError } =
    await allocateDividendNumber(admin, auth.tenantId);
  if (numberError || !declarationNumber) {
    return NextResponse.json({ error: numberError ?? "Numbering failed." }, { status: 500 });
  }

  const now = new Date().toISOString();
  const { data: declaration, error: declError } = await admin
    .from("dividend_declarations")
    .insert({
      tenant_id: auth.tenantId,
      business_unit_id: scoped.businessUnitId,
      declaration_number: declarationNumber,
      declaration_date: declarationDate,
      period_start: periodStart,
      period_end: periodEnd,
      resolution_reference: body.resolution_reference?.trim() || null,
      resolution_notes: body.resolution_notes?.trim() || null,
      gross_amount: grossAmount,
      wht_rate_pct: whtRatePct,
      wht_amount: whtAmount,
      net_amount: netAmount,
      status: "draft",
      created_at: now,
      updated_at: now,
    })
    .select()
    .single();

  if (declError || !declaration) {
    return NextResponse.json(
      { error: declError?.message ?? "Could not save draft." },
      { status: 500 },
    );
  }

  const lineRows = lines.map((line) => ({
    tenant_id: auth.tenantId,
    declaration_id: declaration.id,
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
    await admin.from("dividend_declarations").delete().eq("id", declaration.id);
    return NextResponse.json({ error: linesError.message }, { status: 500 });
  }

  const { rows: allLines } = await fetchDividendDeclarationLines(
    admin,
    auth.tenantId,
    [declaration.id],
  );

  return NextResponse.json({
    declaration,
    lines: allLines,
  });
}
