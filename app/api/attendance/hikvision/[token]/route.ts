import { createAdminClient } from "@/utils/supabase/admin";
import { assertIclockRequestAllowed } from "@/utils/iclock-rate-limit";
import { getRequestIp } from "@/utils/login-rate-limit";
import { hashPushToken } from "@/lib/hikvision/push-token";
import {
  findIsapiDeviceByPushTokenHash,
  touchHikvisionDeviceSeen,
} from "@/lib/hikvision/device-lookup";
import { ingestHikvisionEvent } from "@/lib/hikvision/ingest-event";
import { parseHikvisionRequestBody } from "@/lib/hikvision/parse-event";
import { logHikvisionEvent } from "@/lib/hikvision/log-hikvision-event";

function okEmpty(): Response {
  return new Response(null, { status: 200 });
}

function okText(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

function unauthorized(): Response {
  return new Response("Unauthorized", {
    status: 401,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

type RouteContext = { params: Promise<{ token: string }> };

export async function GET(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const rate = await assertIclockRequestAllowed(request);
  if (!rate.ok) {
    return rate.response;
  }

  const { token } = await context.params;
  const rawToken = decodeURIComponent(token ?? "").trim();
  if (!rawToken) {
    return unauthorized();
  }

  const admin = createAdminClient();
  const device = await findIsapiDeviceByPushTokenHash(
    admin,
    hashPushToken(rawToken),
  );
  if (!device || device.status !== "active") {
    await logHikvisionEvent({
      eventName: "hikvision_unknown_token",
      status: "failure",
      message: "GET with unknown or disabled Hikvision push token",
      metadata: {
        token_hash_prefix: hashPushToken(rawToken).slice(0, 12),
      },
    });
    return unauthorized();
  }

  await touchHikvisionDeviceSeen(admin, device, getRequestIp(request.headers), null);
  return okText("ok");
}

export async function POST(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const rate = await assertIclockRequestAllowed(request);
  if (!rate.ok) {
    return rate.response;
  }

  const { token } = await context.params;
  const rawToken = decodeURIComponent(token ?? "").trim();
  if (!rawToken) {
    await logHikvisionEvent({
      eventName: "hikvision_unknown_token",
      status: "failure",
      message: "POST with empty Hikvision push token",
    });
    return unauthorized();
  }

  const tokenHash = hashPushToken(rawToken);
  const admin = createAdminClient();
  const device = await findIsapiDeviceByPushTokenHash(admin, tokenHash);
  if (!device || device.status !== "active") {
    await logHikvisionEvent({
      eventName: "hikvision_unknown_token",
      status: "failure",
      message: "POST with unknown or disabled Hikvision push token",
      metadata: { token_hash_prefix: tokenHash.slice(0, 12) },
    });
    return unauthorized();
  }

  const lastIp = getRequestIp(request.headers);

  try {
    const parsed = await parseHikvisionRequestBody(request);
    if (!parsed.ok) {
      await logHikvisionEvent({
        eventName: "hikvision_malformed_body",
        status: "warning",
        message: `Malformed or empty Hikvision body (${parsed.reason})`,
        metadata: {
          tenant_id: device.tenant_id,
          device_id: device.id,
          reason: parsed.reason,
        },
      });
      return okEmpty();
    }

    await ingestHikvisionEvent(admin, device, parsed.event, { lastIp });
    return okEmpty();
  } catch (error) {
    await logHikvisionEvent({
      eventName: "hikvision_ingest_error",
      status: "failure",
      message: error instanceof Error ? error.message : "Unknown error",
      metadata: {
        tenant_id: device.tenant_id,
        device_id: device.id,
      },
    });
    return okEmpty();
  }
}
