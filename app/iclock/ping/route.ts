import { assertIclockRequestAllowed } from "@/utils/iclock-rate-limit";
import { iclockText } from "@/lib/adms/iclock-response";

export async function GET(request: Request) {
  const rate = await assertIclockRequestAllowed(request);
  if (!rate.ok) {
    return rate.response;
  }
  return iclockText("OK");
}
