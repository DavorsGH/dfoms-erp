import { NextResponse } from "next/server";
import { requireTenantSuperAdmin } from "@/utils/admin-auth";
import { getLinkedTenantPaystackSubscriptionCode } from "@/utils/billing-subscription";
import { fetchPaystackSubscriptionManageLink } from "@/utils/paystack";

export async function POST() {
  const auth = await requireTenantSuperAdmin();
  if (!auth.ok) {
    return auth.response;
  }

  let subscriptionCode: string | null;
  try {
    subscriptionCode = await getLinkedTenantPaystackSubscriptionCode(
      auth.tenantId,
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unable to load subscription record.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  if (!subscriptionCode) {
    return NextResponse.json(
      {
        error:
          "No Paystack subscription is linked yet. Choose a plan and complete checkout first.",
        needs_checkout: true,
      },
      { status: 404 },
    );
  }

  const linkResult = await fetchPaystackSubscriptionManageLink(subscriptionCode);
  if (!linkResult.ok) {
    return NextResponse.json({ error: linkResult.error }, { status: 502 });
  }

  return NextResponse.json({ link: linkResult.link });
}
