import { redirect } from "next/navigation";
import { getDefaultReportHref } from "../reports-nav-config";

export default function RealEstateReportsPage() {
  redirect(getDefaultReportHref("real-estate"));
}
