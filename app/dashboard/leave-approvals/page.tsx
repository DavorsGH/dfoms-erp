import { redirect } from "next/navigation";

export default function LeaveApprovalsRedirectPage() {
  redirect("/dashboard/self-service/approvals?tab=leave");
}
