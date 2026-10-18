import type { Metadata } from "next";
import { guardSectionAccess } from "@/utils/section-guard";

export const metadata: Metadata = {
  title: "Operations",
};
import { requireFeatureAccess } from "@/utils/tier-access";
import {
  isOperationsReadOnlyRole,
  OPERATIONS_LAYOUT_ROLES,
} from "@/utils/rbac-access";
import { getCurrentUserRole } from "@/utils/dashboard-auth";
import type { AppRole } from "@/app/dashboard/user-account-types";
import { OperationsReadOnlyProvider } from "./operations-read-only-context";

export default async function OperationsLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  await guardSectionAccess(OPERATIONS_LAYOUT_ROLES);
  await requireFeatureAccess("operations");
  const role = (await getCurrentUserRole()) as AppRole | null;
  const readOnly = isOperationsReadOnlyRole(role);

  return (
    <OperationsReadOnlyProvider readOnly={readOnly}>
      {children}
    </OperationsReadOnlyProvider>
  );
}
