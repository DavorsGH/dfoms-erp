import { NextResponse } from "next/server";
import { requireTenantSuperAdmin } from "@/utils/admin-auth";
import { getLinkedTenantPaystackSubscriptionCode } from "@/utils/billing-subscription";
import { fetchPaystackSubscription } from "@/utils/paystack";

export type SubscriptionPaymentMethodResponse = {
  needs_checkout: boolean;
  payment_method: {
    last4: string | null;
    brand: string | null;
    exp_month: string | null;
    exp_year: string | null;
    channel: string | null;
    reusable: boolean | null;
  } | null;
};

export async function GET() {
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
    return NextResponse.json({
      needs_checkout: true,
      payment_method: null,
    } satisfies SubscriptionPaymentMethodResponse);
  }

  const fetched = await fetchPaystackSubscription(subscriptionCode);
  if (!fetched.ok) {
    return NextResponse.json({ error: fetched.error }, { status: 502 });
  }

  const authorization = fetched.subscription.authorization;
  if (!authorization) {
    return NextResponse.json({
      needs_checkout: false,
      payment_method: null,
    } satisfies SubscriptionPaymentMethodResponse);
  }

  return NextResponse.json({
    needs_checkout: false,
    payment_method: {
      last4: authorization.last4,
      brand: authorization.brand,
      exp_month: authorization.expMonth,
      exp_year: authorization.expYear,
      channel: authorization.channel,
      reusable: authorization.reusable,
    },
  } satisfies SubscriptionPaymentMethodResponse);
}
