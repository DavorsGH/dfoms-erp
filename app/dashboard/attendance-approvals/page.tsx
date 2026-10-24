import { redirect } from "next/navigation";

export default function AttendanceApprovalsRedirectPage() {
  redirect("/dashboard/self-service/approvals?tab=attendance");
}
