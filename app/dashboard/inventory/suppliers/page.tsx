import { redirect } from "next/navigation";

export default function InventorySuppliersRedirectPage() {
  redirect("/dashboard/finance/suppliers");
}
