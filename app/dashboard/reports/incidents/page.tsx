import { redirect } from "next/navigation";
import { getDefaultReportHref } from "../reports-nav-config";

export default function IncidentsReportsPage() {
  redirect(getDefaultReportHref("incidents"));
}
