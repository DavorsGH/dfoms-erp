import { NextResponse } from "next/server";
import { logSystemEvent } from "@/lib/system-event-log";
import { runPlatformOnlyUnitTrialReminders } from "@/utils/platform-only-unit-trial-reminders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorizeCronRequest(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) {
    console.error("[platform-unit-trial-reminders] CRON_SECRET is not configured");
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
  const asOfDate = url.searchParams.get("asOfDate")?.trim() || undefined;

  try {
    const result = await runPlatformOnlyUnitTrialReminders({ asOfDate });
    await logSystemEvent({
      eventType: "cron",
      eventName: "platform-unit-trial-reminders",
      status: result.errors > 0 ? "warning" : "success",
      message: `sent14d ${result.sent14d}, sent3d ${result.sent3d}, skipped ${result.skipped}, errors ${result.errors}`,
      metadata: {
        asOfDate: result.asOfDate,
        sent14d: result.sent14d,
        sent3d: result.sent3d,
        skipped: result.skipped,
        errors: result.errors,
      },
    });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Platform unit trial reminders failed";
    console.error("[platform-unit-trial-reminders] fatal", message);
    await logSystemEvent({
      eventType: "cron",
      eventName: "platform-unit-trial-reminders",
      status: "failure",
      message,
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return handleCron(request);
}

export async function POST(request: Request) {
  return handleCron(request);
}
