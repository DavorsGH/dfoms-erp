import { NextResponse } from "next/server";
import { generateRentLedger } from "@/utils/generate-rent-ledger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Allow longer runs when many landlord tenants have active leases. */
export const maxDuration = 300;

function authorizeCronRequest(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) {
    console.error("[generate-rent-ledger] CRON_SECRET is not configured");
    return false;
  }

  const authHeader = request.headers.get("authorization");
  return authHeader === `Bearer ${cronSecret}`;
}

async function handleCron(request: Request) {
  if (!authorizeCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const billingMonth = url.searchParams.get("billingMonth")?.trim() || undefined;
  const asOf = url.searchParams.get("asOf")?.trim() || undefined;

  try {
    const result = await generateRentLedger({ billingMonth, asOf });
    return NextResponse.json({
      success: true,
      billingMonth: result.billingMonth,
      periodStart: result.periodStart,
      periodEnd: result.periodEnd,
      asOfDate: result.asOfDate,
      overdueUpdated: result.overdueUpdated,
      created: result.created,
      skipped: result.skipped,
      errors: result.errors,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Rent ledger generation failed";
    console.error("[generate-rent-ledger] fatal", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * Vercel Cron invokes GET. Manual testing:
 *   curl -H "Authorization: Bearer $CRON_SECRET" \
 *     "https://…/api/cron/generate-rent-ledger?billingMonth=2026-08"
 */
export async function GET(request: Request) {
  return handleCron(request);
}

/** Optional POST for manual testing with the same CRON_SECRET gate. */
export async function POST(request: Request) {
  return handleCron(request);
}
