import { NextResponse } from "next/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { runBalanceSheetIntegrityWithLogging } from "@/utils/balance-sheet-integrity-cron";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorizeCronRequest(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) {
    console.error("[balance-sheet-integrity] CRON_SECRET is not configured");
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
    const admin = createAdminClient();
    const result = await runBalanceSheetIntegrityWithLogging(admin);
    return NextResponse.json({
      success: true,
      runId: result.runId,
      fiscalYear: result.fiscalYear,
      referenceDate: result.referenceDate,
      tenantsChecked: result.tenantsChecked,
      balanced: result.balanced,
      warnings: result.warnings,
      failures: result.failures,
      fetchErrors: result.fetchErrors,
      durationMs: result.durationMs,
      tenants: result.tenantResults.map((row) => ({
        tenantId: row.tenantId,
        tenantName: row.tenantName,
        status: row.status,
        maxAbsDiff: row.maxAbsDiff,
        imbalanceCount: row.imbalances.length,
        fetchError: row.fetchError,
      })),
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Balance sheet integrity check failed";
    console.error("[balance-sheet-integrity] fatal", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * Vercel Cron invokes GET. Manual testing:
 *   curl -H "Authorization: Bearer $CRON_SECRET" \
 *     "https://…/api/cron/balance-sheet-integrity"
 */
export async function GET(request: Request) {
  return handleCron(request);
}

export async function POST(request: Request) {
  return handleCron(request);
}
