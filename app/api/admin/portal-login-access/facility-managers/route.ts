import { handleAdminFacilityManagersLoginAccessGet } from "@/utils/portal-login-access/route-handlers";

export async function GET(request: Request) {
  return handleAdminFacilityManagersLoginAccessGet(request);
}
