import { handleAdminTenantSuperAdminsLoginAccessGet } from "@/utils/portal-login-access/route-handlers";

export async function GET(request: Request) {
  return handleAdminTenantSuperAdminsLoginAccessGet(request);
}
