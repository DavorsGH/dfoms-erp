import { NextResponse } from "next/server";
import { loadDirectorScorecardForSession } from "@/app/dashboard/director-scorecard-load";
import { requireTenantRoleIn } from "@/utils/admin-auth";

export const dynamic = "force-dynamic";

const SCORECARD_VIEW_ROLES = ["director", "super_admin"] as const;

export async function GET(request: Request) {
  const auth = await requireTenantRoleIn(SCORECARD_VIEW_ROLES);
  if (!auth.ok) {
    return auth.response;
  }

  const monthKey = new URL(request.url).searchParams.get("monthKey")?.trim();
  if (!monthKey || !/^\d{4}-\d{2}$/.test(monthKey)) {
    return NextResponse.json(
      { error: "monthKey query parameter is required (YYYY-MM)." },
      { status: 400 },
    );
  }

  const bundle = await loadDirectorScorecardForSession(monthKey);
  if ("error" in bundle) {
    return NextResponse.json(
      { error: bundle.error, fetchWarning: bundle.fetchWarning ?? null },
      { status: 404 },
    );
  }

  return NextResponse.json({
    snapshot: bundle.snapshot,
    settings: bundle.scorecardSettings,
    monthKey: bundle.monthKey,
  });
}
