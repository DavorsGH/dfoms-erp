import { redirect } from "next/navigation";

export default function LegacyLoginActivityRedirect() {
  redirect("/dashboard/administration/login-activity");
}
