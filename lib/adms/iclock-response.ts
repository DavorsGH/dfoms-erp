export function iclockText(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}

export function buildHandshakeOptionsBlock(input: {
  serialNumber: string;
  timeZoneOffsetHours: number;
}): string {
  const offset = Number.isFinite(input.timeZoneOffsetHours)
    ? Math.trunc(input.timeZoneOffsetHours)
    : 0;
  return [
    `GET OPTION FROM: ${input.serialNumber}`,
    "ATTLOGStamp=None",
    "OPERLOGStamp=9999",
    "ATTPHOTOStamp=None",
    "ErrorDelay=30",
    "Delay=10",
    "TransTimes=00:00;14:05",
    "TransInterval=1",
    "TransFlag=TransData AttLog",
    `TimeZone=${offset}`,
    "Realtime=1",
    "Encrypt=None",
  ].join("\n");
}
