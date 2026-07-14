import { redirect } from "next/navigation";
import { getDefaultReportHref } from "./reports-nav-config";

export default function ReportsPage() {
  redirect(getDefaultReportHref("finance"));
}
