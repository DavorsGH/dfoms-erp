import { redirect } from "next/navigation";

export default function RemovedLoginActivityRedirect() {
  redirect("/dashboard/administration");
}
