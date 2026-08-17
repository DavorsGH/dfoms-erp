import { NextResponse } from "next/server";
import { createAdminClient } from "@/utils/supabase/admin";
import {
  isDuplicateEmailError,
  validateSignupInput,
  type SignupRequestBody,
} from "@/utils/tenant-signup";
import { mapSupabasePasswordError } from "@/utils/password-policy";
import { recordPasswordUpdatedAt } from "@/lib/security/password-updated-at";
import { provisionStaffTenantSignup } from "@/utils/staff-tenant-signup";

export async function POST(request: Request) {
  let body: SignupRequestBody;

  try {
    body = (await request.json()) as SignupRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const validation = validateSignupInput(body);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const { companyName, adminFullName, adminEmail, password } = validation.data;
  const admin = createAdminClient();

  const { data: authData, error: authError } = await admin.auth.admin.createUser({
    email: adminEmail,
    password,
    email_confirm: false,
    user_metadata: {
      full_name: adminFullName,
      company_name: companyName,
      portal: "staff",
    },
  });

  if (authError || !authData.user) {
    return NextResponse.json(
      {
        error: isDuplicateEmailError(authError?.message ?? "")
          ? "An account with this email already exists."
          : mapSupabasePasswordError(authError ?? { message: "Failed to create auth user." }),
      },
      { status: 400 },
    );
  }

  await recordPasswordUpdatedAt(authData.user.id);

  const provisioned = await provisionStaffTenantSignup(
    admin,
    {
      authUserId: authData.user.id,
      companyName,
      adminFullName,
      adminEmail,
    },
    { deleteAuthUserOnRollback: true },
  );

  if (!provisioned.ok) {
    return NextResponse.json(
      { error: provisioned.error },
      { status: provisioned.status },
    );
  }

  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: "signup",
    email: adminEmail,
    password,
  });

  if (linkError || !linkData?.properties?.hashed_token) {
    console.error("Failed to generate signup verification link:", linkError?.message);
  } else {
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://portal.davorsfacilities.com";
    const verifyUrl = `${siteUrl}/verify-email?token_hash=${linkData.properties.hashed_token}&type=signup`;

    try {
      const resendResponse = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "Davors Facilities ERP <noreply@davorsfacilities.com>",
          to: adminEmail,
          subject: "Confirm your email address",
          html: `<h2>Confirm your email address</h2><p>Follow the link below to confirm this email address.</p><p><a href="${verifyUrl}">Confirm email address</a></p>`,
        }),
      });

      if (!resendResponse.ok) {
        console.error("Failed to send signup confirmation email:", await resendResponse.text());
      }
    } catch (emailSendError) {
      console.error("Error sending signup confirmation email:", emailSendError);
    }
  }

  return NextResponse.json({
    message:
      "Account created. You can log in now — check your email for a link to verify your address.",
    tenant_id: provisioned.tenantId,
    slug: provisioned.slug,
    client_id: provisioned.clientId,
  });
}
