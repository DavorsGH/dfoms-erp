import { redirect } from "next/navigation";
import { getDefaultReportHref } from "../reports-nav-config";

export default function ClientReportsPage() {
  redirect(getDefaultReportHref("client-facing"));
}
