import { handlePortalLoginAccessResetLinkPost } from "@/utils/portal-login-access/route-handlers";

export async function POST(request: Request) {
  return handlePortalLoginAccessResetLinkPost(request, "landlord");
}
