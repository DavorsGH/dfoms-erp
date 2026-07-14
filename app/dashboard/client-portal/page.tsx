import { redirect } from "next/navigation";

export default function ClientPortalPage() {
  redirect("/dashboard/client-portal/invoices");
}
