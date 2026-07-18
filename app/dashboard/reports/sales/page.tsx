import { redirect } from "next/navigation";
import { getDefaultReportHref } from "../reports-nav-config";

export default function SalesReportsPage() {
  redirect(getDefaultReportHref("sales"));
}
