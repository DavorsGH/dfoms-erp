import { redirect } from "next/navigation";
import { hasLeaveApprovalInbox } from "@/utils/dashboard-auth";

export default async function LeaveApprovalsLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  if (!(await hasLeaveApprovalInbox())) {
    redirect("/dashboard");
  }

  return <>{children}</>;
}
