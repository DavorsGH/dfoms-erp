import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  requireDividendsRead,
  requireDividendsScopedBusinessUnit,
} from "@/lib/finance/dividends-auth";
import { getRetainedEarningsAsOfDate } from "@/lib/finance/dividends-retained-check";
import { loadDividendDeclareReadiness } from "@/lib/finance/dividends-declare-readiness";
import { createClient } from "@/utils/supabase/server";

export async function GET(request: Request) {
  const auth = await requireDividendsRead();
  if (!auth.ok) {
    return auth.response;
  }

  const scoped = await requireDividendsScopedBusinessUnit();
  if (!scoped.ok) {
    return scoped.response;
  }

  const declarationDate =
    new URL(request.url).searchParams.get("declaration_date")?.slice(0, 10) ??
    "";
  if (!declarationDate) {
    return NextResponse.json(
      { error: "declaration_date is required." },
      { status: 400 },
    );
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const [{ retainedEarnings, error: reError }, readiness] = await Promise.all([
    getRetainedEarningsAsOfDate({
      supabase,
      tenantId: auth.tenantId,
      businessUnitId: scoped.businessUnitId,
      asOfDate: declarationDate,
    }),
    loadDividendDeclareReadiness({
      supabase,
      tenantId: auth.tenantId,
      businessUnitId: scoped.businessUnitId,
      declarationDate,
      grossAmount: 0,
    }),
  ]);

  if (reError) {
    return NextResponse.json({ error: reError }, { status: 400 });
  }
  if (readiness.error) {
    return NextResponse.json({ error: readiness.error }, { status: 400 });
  }

  const monthKey = declarationDate.slice(0, 7);
  const bundle = await import("@/app/dashboard/director-scorecard-load").then(
    (m) => m.loadDirectorScorecardForSession(monthKey),
  );
  const declaredThisQuarter =
    "snapshot" in bundle
      ? bundle.snapshot.dividendQuarter.declaredGross
      : null;
  const dividendAvailable =
    "snapshot" in bundle ? bundle.snapshot.dividendQuarter.gross : null;

  return NextResponse.json({
    retainedEarnings,
    dividendAvailable,
    declaredThisQuarter,
  });
}
