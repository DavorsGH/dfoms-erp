import { redirect } from "next/navigation";
import { getDefaultReportHref } from "../reports-nav-config";

export default function FinanceReportsPage() {
  redirect(getDefaultReportHref("finance"));
}
