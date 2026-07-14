import { redirect } from "next/navigation";
import { getDefaultReportHref } from "../reports-nav-config";

export default function OperationsReportsPage() {
  redirect(getDefaultReportHref("operations"));
}
