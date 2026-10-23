import { handlePortalLoginAccessChangeEmailPost } from "@/utils/portal-login-access/route-handlers";

export async function POST(request: Request) {
  return handlePortalLoginAccessChangeEmailPost(request, "landlord");
}
