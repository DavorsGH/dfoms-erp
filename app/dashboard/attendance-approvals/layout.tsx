import { redirect } from "next/navigation";
import {
  getCurrentUserRole,
  isCurrentLeaveApprover,
} from "@/utils/dashboard-auth";

export default async function AttendanceApprovalsLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const role = await getCurrentUserRole();
  const allowed =
    role === "director" ||
    role === "super_admin" ||
    (await isCurrentLeaveApprover());
  if (!allowed) {
    redirect("/dashboard");
  }

  return <>{children}</>;
}
