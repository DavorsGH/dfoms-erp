import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { getMfaSettingsForCurrentUser } from "@/lib/mfa/enrollment-actions";
import StaffMfaSettingsClient from "./mfa-settings-client";

export default async function StaffMfaSettingsPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const settings = await getMfaSettingsForCurrentUser("staff");

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/dashboard/my-account"
          className="text-sm text-slate-500 underline hover:text-slate-800"
        >
          ← Back to My Account
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-[#0f2744]">
          Two-factor authentication
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Optional extra sign-in protection. Choose either an authenticator app
          or SMS — not both.
        </p>
      </div>
      <StaffMfaSettingsClient initialSettings={settings} />
    </div>
  );
}
