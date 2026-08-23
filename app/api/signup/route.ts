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
import {
  crossPersonaErrorMessage,
  findCrossPersonaConflictForEmail,
} from "@/lib/auth/cross-persona-guard";
import {
  findAuthUserIdByEmail,
  findStaffAccountByEmail,
  REUSED_ACCOUNT_LOGIN_HINT,
  scrubStaffTenantBindings,
} from "@/utils/email-reuse";

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

  const crossPersona = await findCrossPersonaConflictForEmail(admin, adminEmail);
  if (crossPersona) {
    return NextResponse.json(
      { error: crossPersonaErrorMessage(crossPersona) },
      { status: 409 },
    );
  }

  const existingAuthUserId = await findAuthUserIdByEmail(admin, adminEmail);
  const existingStaff = existingAuthUserId
    ? await findStaffAccountByEmail(admin, adminEmail)
    : null;

  if (existingAuthUserId && existingStaff?.is_active) {
    return NextResponse.json(
      {
        error:
          "This email is in use by an active account at another business.",
      },
      { status: 409 },
    );
  }

  let authUserId: string;
  let reusedExistingAccount = false;
  let deleteAuthUserOnRollback = true;

  if (existingAuthUserId) {
    // Sequential reuse: same Auth identity, move into a new company workspace.
    authUserId = existingAuthUserId;
    reusedExistingAccount = true;
    deleteAuthUserOnRollback = false;

    if (existingStaff) {
      const scrub = await scrubStaffTenantBindings(
        admin,
        existingAuthUserId,
        existingStaff.tenant_id,
      );
      if (!scrub.ok) {
        return NextResponse.json({ error: scrub.error }, { status: 400 });
      }
      await admin.from("user_accounts").delete().eq("auth_uid", existingAuthUserId);
    }
  } else {
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
            : mapSupabasePasswordError(
                authError ?? { message: "Failed to create auth user." },
              ),
        },
        { status: 400 },
      );
    }

    authUserId = authData.user.id;
    await recordPasswordUpdatedAt(authUserId);
  }

  const provisioned = await provisionStaffTenantSignup(
    admin,
    {
      authUserId,
      companyName,
      adminFullName,
      adminEmail,
    },
    { deleteAuthUserOnRollback },
  );

  if (!provisioned.ok) {
    return NextResponse.json(
      { error: provisioned.error },
      { status: provisioned.status },
    );
  }

  if (!reusedExistingAccount) {
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
  }

  return NextResponse.json({
    message: reusedExistingAccount
      ? `Workspace created. ${REUSED_ACCOUNT_LOGIN_HINT}`
      : "Account created. You can log in now — check your email for a link to verify your address.",
    tenant_id: provisioned.tenantId,
    slug: provisioned.slug,
    client_id: provisioned.clientId,
    reusedExistingAccount,
  });
}
