import { createAdminClient } from "@/utils/supabase/admin";
import { assertIclockRequestAllowed } from "@/utils/iclock-rate-limit";
import { getRequestIp } from "@/utils/login-rate-limit";
import { iclockText } from "@/lib/adms/iclock-response";
import { logAdmsEvent } from "@/lib/adms/log-adms-event";
import {
  findDeviceBySerial,
  recordUnclaimedSerial,
  touchDeviceSeen,
} from "@/lib/adms/device-registry";

export async function GET(request: Request) {
  const rate = await assertIclockRequestAllowed(request);
  if (!rate.ok) {
    return rate.response;
  }

  try {
    const url = new URL(request.url);
    const serialNumber = (url.searchParams.get("SN") ?? "").trim();
    const lastIp = getRequestIp(request.headers);
    const admin = createAdminClient();
    const device = await findDeviceBySerial(admin, serialNumber);

    if (!device || device.status === "disabled") {
      await recordUnclaimedSerial(admin, serialNumber, lastIp);
      return iclockText("OK");
    }

    // DeviceTime on this heartbeat is a fresh reading only. It is not stored,
    // and it is not applied to punches that arrive later.
    void url.searchParams.get("DeviceTime");
    await touchDeviceSeen(admin, device, lastIp);
    return iclockText("OK");
  } catch (error) {
    await logAdmsEvent({
      eventName: "adms_getrequest_error",
      status: "failure",
      message: error instanceof Error ? error.message : "Unknown error",
    });
    return iclockText("OK");
  }
}
