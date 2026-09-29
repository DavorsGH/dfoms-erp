import type { NextResponse } from "next/server";
import {
  DFOMS_ROUTE_REGION_HEADER,
  DFOMS_ROUTE_RTT1_HEADER,
  DFOMS_ROUTE_RTT2_HEADER,
  getVercelRegion,
} from "@/lib/perf-probe-headers";
import { measureSupabaseHealthRttTwice } from "@/lib/supabase-http-perf";
import { isPerfProbeEnabled } from "@/utils/perf-probe";

/** Badge poll JSON responses only — gated on DFOMS_PERF_PROBE. */
export async function attachBadgeRoutePerfProbeHeaders(
  response: NextResponse,
): Promise<NextResponse> {
  if (!isPerfProbeEnabled()) {
    return response;
  }
  const { rtt1Ms, rtt2Ms } = await measureSupabaseHealthRttTwice();
  response.headers.set(DFOMS_ROUTE_REGION_HEADER, getVercelRegion());
  response.headers.set(DFOMS_ROUTE_RTT1_HEADER, String(rtt1Ms));
  response.headers.set(DFOMS_ROUTE_RTT2_HEADER, String(rtt2Ms));
  return response;
}
