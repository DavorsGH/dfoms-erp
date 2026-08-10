import { redirect } from "next/navigation";

export default function OperationsClientsRedirectPage() {
  redirect("/dashboard/crm/customers");
}
