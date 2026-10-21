import { createAdminClient } from "@/utils/supabase/admin";
import { assertIclockRequestAllowed } from "@/utils/iclock-rate-limit";
import { getRequestIp } from "@/utils/login-rate-limit";
import {
  buildHandshakeOptionsBlock,
  iclockText,
} from "@/lib/adms/iclock-response";
import {
  findDeviceBySerial,
  recordUnclaimedSerial,
  touchDeviceSeen,
} from "@/lib/adms/device-registry";
import { deviceTimezoneOrDefault, timezoneOffsetHours } from "@/lib/adms/timezone-utils";
import { ingestAttlogPost } from "@/lib/adms/ingest-attlog";
import { iclockUploadIsAttlog } from "@/lib/adms/iclock-table";
import { logAdmsEvent } from "@/lib/adms/log-adms-event";

function serialFromUrl(url: URL): string {
  return (url.searchParams.get("SN") ?? "").trim();
}

export async function GET(request: Request) {
  const rate = await assertIclockRequestAllowed(request);
  if (!rate.ok) {
    return rate.response;
  }

  try {
    const url = new URL(request.url);
    const serialNumber = serialFromUrl(url);
    const pushver = url.searchParams.get("pushver") ?? "";
    const options = url.searchParams.get("options") ?? "";
    const lastIp = getRequestIp(request.headers);
    const admin = createAdminClient();

    const device = await findDeviceBySerial(admin, serialNumber);
    if (!device) {
      await recordUnclaimedSerial(admin, serialNumber, lastIp);
      return iclockText("OK");
    }

    if (device.status === "disabled") {
      await touchDeviceSeen(admin, device, lastIp);
      return iclockText("OK");
    }

    const firmwareSummary = [pushver, options].filter(Boolean).join(" | ");
    await touchDeviceSeen(
      admin,
      device,
      lastIp,
      firmwareSummary || null,
    );

    const tz = deviceTimezoneOrDefault(device.timezone);
    const block = buildHandshakeOptionsBlock({
      serialNumber,
      timeZoneOffsetHours: timezoneOffsetHours(tz),
    });
    return iclockText(block);
  } catch (error) {
    await logAdmsEvent({
      eventName: "adms_cdata_get_error",
      status: "failure",
      message: error instanceof Error ? error.message : "Unknown error",
    });
    return iclockText("OK");
  }
}

export async function POST(request: Request) {
  const rate = await assertIclockRequestAllowed(request);
  if (!rate.ok) {
    return rate.response;
  }

  try {
    const url = new URL(request.url);
    const serialNumber = serialFromUrl(url);
    const table = (url.searchParams.get("table") ?? "").trim().toUpperCase();
    const lastIp = getRequestIp(request.headers);
    const body = await request.text();
    const admin = createAdminClient();

    const device = await findDeviceBySerial(admin, serialNumber);
    if (!device || device.status === "disabled") {
      await recordUnclaimedSerial(admin, serialNumber, lastIp);
      return iclockText("OK");
    }

    if (!iclockUploadIsAttlog(table)) {
      await touchDeviceSeen(admin, device, lastIp);
      return iclockText("OK");
    }

    const { acceptedLines } = await ingestAttlogPost(admin, device, body, {
      freshDeviceClockLocal: url.searchParams.get("DeviceTime"),
    });
    await touchDeviceSeen(admin, device, lastIp);
    return iclockText(`OK: ${acceptedLines}`);
  } catch (error) {
    await logAdmsEvent({
      eventName: "adms_cdata_post_error",
      status: "failure",
      message: error instanceof Error ? error.message : "Unknown error",
    });
    return iclockText("OK");
  }
}
