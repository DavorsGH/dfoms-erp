import { handlePortalLoginAccessTempPasswordPost } from "@/utils/portal-login-access/route-handlers";

export async function POST(request: Request) {
  return handlePortalLoginAccessTempPasswordPost(request, "admin");
}
