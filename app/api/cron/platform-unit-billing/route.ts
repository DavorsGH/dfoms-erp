import { NextResponse } from "next/server";
import { runPlatformOnlyUnitMonthlyBilling } from "@/utils/platform-only-unit-monthly-billing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Allow longer runs when many platform_only landlords have active units. */
export const maxDuration = 300;

function authorizeCronRequest(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) {
    console.error("[platform-unit-billing] CRON_SECRET is not configured");
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

  try {
    const result = await runPlatformOnlyUnitMonthlyBilling({ billingMonth });
    return NextResponse.json({
      success: true,
      billingMonth: result.billingMonth,
      periodStart: result.periodStart,
      periodEnd: result.periodEnd,
      charged: result.charged,
      skippedTrial: result.skippedTrial,
      skippedZeroUnits: result.skippedZeroUnits,
      skippedAlreadyBilled: result.skippedAlreadyBilled,
      failed: result.failed,
      errors: result.errors,
      details: result.details,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Platform unit monthly billing failed";
    console.error("[platform-unit-billing] fatal", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * Vercel Cron invokes GET. Manual testing:
 *   curl -H "Authorization: Bearer $CRON_SECRET" \
 *     "https://…/api/cron/platform-unit-billing?billingMonth=2026-08"
 */
export async function GET(request: Request) {
  return handleCron(request);
}

/** Optional POST for manual testing with the same CRON_SECRET gate. */
export async function POST(request: Request) {
  return handleCron(request);
}
