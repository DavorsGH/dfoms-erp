import { NextResponse } from "next/server";
import { runPaystackReconciliationWithLogging } from "@/utils/paystack-reconciliation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorizeCronRequest(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) {
    console.error("[paystack-reconciliation] CRON_SECRET is not configured");
    return false;
  }

  const authHeader = request.headers.get("authorization");
  return authHeader === `Bearer ${cronSecret}`;
}

async function handleCron(request: Request) {
  if (!authorizeCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runPaystackReconciliationWithLogging();
    return NextResponse.json({
      success: true,
      windowStart: result.windowStart,
      windowEnd: result.windowEnd,
      paystackTransactions: result.paystackTransactions,
      issueCount: result.issues.length,
      issues: result.issues,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Paystack reconciliation failed";
    console.error("[paystack-reconciliation] fatal", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * Vercel Cron invokes GET. Manual testing:
 *   curl -H "Authorization: Bearer $CRON_SECRET" \
 *     "https://…/api/cron/paystack-reconciliation"
 */
export async function GET(request: Request) {
  return handleCron(request);
}

export async function POST(request: Request) {
  return handleCron(request);
}
