import { redirect } from "next/navigation";

export default function LegacySitesPage() {
  redirect("/dashboard/administration/sites");
}
