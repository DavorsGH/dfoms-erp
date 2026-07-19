import Image from "next/image";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";

export default async function Home() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect("/dashboard");
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#0F2744] px-4 py-10">
      <div className="w-full max-w-md rounded-lg border border-zinc-200 bg-white p-8 shadow-sm">
        <div className="mb-4 flex justify-center">
          <Image
            src="/icons/apple-touch-icon-180x180.png"
            alt="Davors Facilities"
            width={80}
            height={80}
            className="h-20 w-20"
            priority
          />
        </div>
        <h1 className="mb-2 text-center text-2xl font-semibold text-zinc-900">
          Davors Facilities ERP
        </h1>
        <p className="mb-8 text-center text-sm text-zinc-600">
          Sign in to your workspace or start a free tier for your company.
        </p>

        <div className="flex flex-col gap-3">
          <Link
            href="/login"
            className="inline-flex w-full items-center justify-center rounded-md bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700"
          >
            Log In
          </Link>
          <Link
            href="/signup"
            className="inline-flex w-full items-center justify-center rounded-md border border-[#0f2744] px-4 py-2.5 text-sm font-medium text-[#0f2744] transition-colors hover:bg-slate-50"
          >
            Sign up for free
          </Link>
        </div>
      </div>
    </div>
  );
}
