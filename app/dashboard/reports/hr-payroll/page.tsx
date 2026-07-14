import { redirect } from "next/navigation";
import { getDefaultReportHref } from "../reports-nav-config";

export default function HrPayrollReportsPage() {
  redirect(getDefaultReportHref("hr-payroll"));
}
