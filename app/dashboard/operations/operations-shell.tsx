import { getCurrentUserRole } from "@/utils/dashboard-auth";
import type { AppRole } from "../user-account-types";
import OperationsNav from "./operations-nav";

type OperationsShellProps = {
  children: React.ReactNode;
  sectionTitle: string;
};

export default async function OperationsShell({
  children,
  sectionTitle,
}: OperationsShellProps) {
  const role = (await getCurrentUserRole()) as AppRole | null;

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-[#0f2744]">Operations</h1>
      <OperationsNav showCustomerList={role === "supervisor"} />
      <h2 className="mb-6 text-xl font-semibold text-[#0f2744]">{sectionTitle}</h2>
      {children}
    </div>
  );
}
