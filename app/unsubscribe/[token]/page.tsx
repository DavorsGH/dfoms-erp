import { createAdminClient } from "@/utils/supabase/admin";

type PageProps = {
  params: Promise<{ token: string }>;
};

export default async function UnsubscribePage({ params }: PageProps) {
  const { token } = await params;
  const cleaned = token?.trim() ?? "";

  let headline = "This link is no longer valid";
  let detail =
    "The unsubscribe link may have expired or already been used. If you still receive messages, contact the sender directly.";
  let ok = false;

  if (cleaned) {
    try {
      const admin = createAdminClient();
      const { data: pref } = await admin
        .from("customer_comm_preferences")
        .select("id, tenant_id, unsubscribed_at")
        .eq("unsubscribe_token", cleaned)
        .maybeSingle();

      if (pref) {
        const { data: tenant } = await admin
          .from("tenants")
          .select("name")
          .eq("id", pref.tenant_id)
          .maybeSingle();
        const tenantName = tenant?.name?.trim() || "this workspace";

        if (!pref.unsubscribed_at) {
          const now = new Date().toISOString();
          await admin
            .from("customer_comm_preferences")
            .update({
              unsubscribed_at: now,
              email_opt_in: false,
              sms_opt_in: false,
              updated_at: now,
            })
            .eq("id", pref.id);
        }

        ok = true;
        headline = `You've been unsubscribed from ${tenantName}'s communications.`;
        detail =
          "You will no longer receive marketing email or SMS from this sender. Transactional messages about your account may still apply where required.";
      }
    } catch {
      ok = false;
      headline = "This link is no longer valid";
    }
  }

  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-100 to-slate-200 px-4 py-16 text-slate-900">
      <div className="mx-auto max-w-lg rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-[#0f2744]">
          Davors Facilities
        </p>
        <h1 className="mt-3 text-2xl font-semibold text-[#0f2744]">{headline}</h1>
        <p className="mt-3 text-sm leading-relaxed text-slate-600">{detail}</p>
        {ok ? (
          <p className="mt-6 text-xs text-slate-500">
            You can close this page.
          </p>
        ) : null}
      </div>
    </main>
  );
}
