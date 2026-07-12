import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import LogoutButton from "./logout-button";

export default async function DashboardPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="flex min-h-full flex-col items-center justify-center bg-zinc-50 px-4">
      <div className="w-full max-w-md rounded-lg border border-zinc-200 bg-white p-8 text-center shadow-sm">
        <h1 className="mb-2 text-2xl font-semibold text-zinc-900">Welcome</h1>
        <p className="mb-6 text-zinc-600">{user?.email}</p>
        <LogoutButton />
      </div>
    </div>
  );
}
