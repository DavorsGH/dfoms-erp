import { NextResponse } from "next/server";
import {
  extractFormulaDcDeliveryStatus,
  probeFormulaDcMessageStatus,
} from "@/utils/formula-dc-sms-status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorizeCronRequest(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) return false;
  const authHeader = request.headers.get("authorization");
  return authHeader === `Bearer ${cronSecret}`;
}

/**
 * Probe Formula-DC delivery status for one or more message_ids.
 * POST { "messageIds": ["uuid", ...] }
 */
export async function POST(request: Request) {
  if (process.env.VERCEL_ENV !== "preview") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (!authorizeCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    messageIds?: string[];
  };
  const messageIds = (body.messageIds ?? [])
    .map((id) => id.trim())
    .filter(Boolean);

  if (messageIds.length === 0) {
    return NextResponse.json(
      { error: "messageIds array required" },
      { status: 400 },
    );
  }

  const results = [];
  for (const messageId of messageIds) {
    const probes = await probeFormulaDcMessageStatus(messageId);
    const successful = probes.filter((p) => p.httpStatus >= 200 && p.httpStatus < 300);
    const best =
      successful.find((p) => extractFormulaDcDeliveryStatus(p.body) !== null) ??
      successful[0] ??
      null;

    results.push({
      messageId,
      resolvedStatus: best ? extractFormulaDcDeliveryStatus(best.body) : null,
      bestProbe: best,
      probes,
    });
  }

  return NextResponse.json({ results });
}
