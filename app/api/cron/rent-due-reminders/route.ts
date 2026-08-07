import { NextResponse } from "next/server";
import { logSystemEvent } from "@/lib/system-event-log";
import { runRentDueReminders } from "@/utils/rent-due-reminders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Allow longer runs when many landlords have open rent balances. */
export const maxDuration = 300;

function authorizeCronRequest(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) {
    console.error("[rent-due-reminders] CRON_SECRET is not configured");
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
  const asOf = url.searchParams.get("asOf")?.trim() || undefined;
  const tenantId = url.searchParams.get("tenantId")?.trim() || undefined;

  try {
    const result = await runRentDueReminders({ asOf, tenantId });
    const errorCount = result.errors;
    await logSystemEvent({
      eventType: "cron",
      eventName: "rent-due-reminders",
      status: errorCount > 0 ? "warning" : "success",
      message: `considered ${result.considered}, notified ${result.notified}, skipped ${result.skipped}, errors ${errorCount}`,
      metadata: {
        asOfDate: result.asOfDate,
        windowEndDate: result.windowEndDate,
        considered: result.considered,
        notified: result.notified,
        skipped: result.skipped,
        errorCount,
      },
    });
    return NextResponse.json({
      success: true,
      asOfDate: result.asOfDate,
      windowEndDate: result.windowEndDate,
      considered: result.considered,
      notified: result.notified,
      skipped: result.skipped,
      errors: result.errors,
      entries: result.entries,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Rent due reminders failed";
    console.error("[rent-due-reminders] fatal", message);
    await logSystemEvent({
      eventType: "cron",
      eventName: "rent-due-reminders",
      status: "failure",
      message,
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * Vercel Cron invokes GET. Manual testing:
 *   curl -H "Authorization: Bearer $CRON_SECRET" \
 *     "https://…/api/cron/rent-due-reminders"
 * Optional query: ?asOf=2026-08-02&tenantId=<uuid>
 */
export async function GET(request: Request) {
  return handleCron(request);
}

/** Optional POST for manual testing with the same CRON_SECRET gate. */
export async function POST(request: Request) {
  return handleCron(request);
}
