import { redirect } from "next/navigation";
import { getCurrentUserRole } from "@/utils/dashboard-auth";
import { canAccessDirectorsBoard } from "@/utils/rbac-access";
import type { AppRole } from "@/app/dashboard/user-account-types";

/** Legacy Finance URL — dividends live on the Directors board. */
export default async function FinanceDividendsRedirectPage() {
  const role = (await getCurrentUserRole()) as AppRole | null;
  if (canAccessDirectorsBoard(role)) {
    redirect("/dashboard/directors?tab=dividends");
  }
  redirect("/dashboard");
}
