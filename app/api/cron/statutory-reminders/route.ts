import { NextResponse } from "next/server";
import { logSystemEvent } from "@/lib/system-event-log";
import { runStatutoryReminders } from "@/utils/statutory-reminders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorizeCronRequest(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) {
    console.error("[statutory-reminders] CRON_SECRET is not configured");
    return false;
  }

  const authHeader = request.headers.get("authorization");
  return authHeader === `Bearer ${cronSecret}`;
}

function parseDryRun(url: URL): boolean {
  const value = url.searchParams.get("dryRun")?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

async function handleCron(request: Request) {
  if (!authorizeCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const dryRun = parseDryRun(url);
  const tenantId = url.searchParams.get("tenantId")?.trim() || undefined;
  const asOfParam = url.searchParams.get("asOf")?.trim();
  const asOf = dryRun ? asOfParam || undefined : undefined;

  if (!dryRun && asOfParam) {
    return NextResponse.json(
      {
        error:
          "asOf is only allowed with dryRun=1 (use dry run to simulate dates).",
      },
      { status: 400 },
    );
  }

  try {
    const result = await runStatutoryReminders({
      dryRun,
      tenantId,
      asOf,
    });

    await logSystemEvent({
      eventType: "cron",
      eventName: "statutory-reminders",
      status: result.errors > 0 ? "warning" : "success",
      message: dryRun
        ? `dry-run ${result.planned} planned sends for ${result.asOfDate}`
        : `in-app ${result.sentInApp}, sms ${result.sentSms}, skipped ${result.skipped}, errors ${result.errors}`,
      metadata: {
        asOfDate: result.asOfDate,
        dryRun: result.dryRun,
        tenantsConsidered: result.tenantsConsidered,
        obligationsConsidered: result.obligationsConsidered,
        planned: result.planned,
        sentInApp: result.sentInApp,
        sentSms: result.sentSms,
        skipped: result.skipped,
        errorCount: result.errors,
      },
    });

    const { debug, ...publicResult } = result;
    return NextResponse.json({
      success: true,
      ...publicResult,
      ...(dryRun && debug ? { debug } : {}),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Statutory reminders failed";
    console.error("[statutory-reminders] fatal", message);
    await logSystemEvent({
      eventType: "cron",
      eventName: "statutory-reminders",
      status: "failure",
      message,
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * Daily 08:00 Africa/Accra (08:00 UTC) via vercel.json.
 * Dry run (no sends):
 *   curl -H "Authorization: Bearer $CRON_SECRET" \
 *     "https://…/api/cron/statutory-reminders?dryRun=1&asOf=2026-10-28"
 * Optional: &tenantId=<uuid>
 */
export async function GET(request: Request) {
  return handleCron(request);
}

export async function POST(request: Request) {
  return handleCron(request);
}
