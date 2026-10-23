import { handlePortalLoginAccessCreateLoginPost } from "@/utils/portal-login-access/route-handlers";

export async function POST(request: Request) {
  return handlePortalLoginAccessCreateLoginPost(request, "tenant_admin");
}
