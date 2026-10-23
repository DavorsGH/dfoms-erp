import { handlePortalLoginAccessStatusGet } from "@/utils/portal-login-access/route-handlers";

export async function GET(request: Request) {
  return handlePortalLoginAccessStatusGet(request, "admin");
}
