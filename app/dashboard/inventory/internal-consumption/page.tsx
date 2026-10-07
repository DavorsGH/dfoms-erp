import { redirect } from "next/navigation";

export default function InternalConsumptionRedirectPage() {
  redirect("/dashboard/inventory/finished-products#internal-use");
}
