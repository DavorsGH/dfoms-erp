import { redirect } from "next/navigation";
import {
  hasAttendanceApprovalInbox,
  hasLeaveApprovalInbox,
} from "@/utils/dashboard-auth";

export default async function SelfServiceApprovalsLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const [showLeave, showAttendance] = await Promise.all([
    hasLeaveApprovalInbox(),
    hasAttendanceApprovalInbox(),
  ]);
  if (!showLeave && !showAttendance) {
    redirect("/dashboard");
  }

  return <>{children}</>;
}
