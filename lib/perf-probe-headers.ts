/** Response / meta probe headers — only set when DFOMS_PERF_PROBE=true. */

export const DFOMS_MW_REGION_HEADER = "x-dfoms-mw-region";
export const DFOMS_ROUTE_REGION_HEADER = "x-dfoms-route-region";
export const DFOMS_MW_RTT1_HEADER = "x-dfoms-mw-rtt1-ms";
export const DFOMS_MW_RTT2_HEADER = "x-dfoms-mw-rtt2-ms";
export const DFOMS_ROUTE_RTT1_HEADER = "x-dfoms-route-rtt1-ms";
export const DFOMS_ROUTE_RTT2_HEADER = "x-dfoms-route-rtt2-ms";

export function getVercelRegion(): string {
  return (
    process.env.VERCEL_REGION?.trim() ||
    process.env.AWS_REGION?.trim() ||
    "unknown"
  );
}
