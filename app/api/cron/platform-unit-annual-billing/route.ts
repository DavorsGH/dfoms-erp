import { NextResponse } from "next/server";
import { logSystemEvent } from "@/lib/system-event-log";
import { runPlatformOnlyUnitAnnualBilling } from "@/utils/platform-only-unit-annual-billing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorizeCronRequest(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) {
    console.error("[platform-unit-annual-billing] CRON_SECRET is not configured");
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
    const result = await runPlatformOnlyUnitAnnualBilling({ asOfDate });
    const errorCount = result.errors;
    await logSystemEvent({
      eventType: "cron",
      eventName: "platform-unit-annual-billing",
      status: errorCount > 0 || result.failed > 0 ? "warning" : "success",
      message: `charged ${result.charged}, flips ${result.pendingFlips}, failed ${result.failed}, errors ${errorCount}`,
      metadata: {
        asOfDate: result.asOfDate,
        pendingFlips: result.pendingFlips,
        charged: result.charged,
        failed: result.failed,
        skippedTrial: result.skippedTrial,
        skippedZeroUnits: result.skippedZeroUnits,
        skippedAlreadyBilled: result.skippedAlreadyBilled,
        errorCount,
      },
    });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Platform unit annual billing failed";
    console.error("[platform-unit-annual-billing] fatal", message);
    await logSystemEvent({
      eventType: "cron",
      eventName: "platform-unit-annual-billing",
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
