import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/utils/admin-auth";
import { createAdminClient } from "@/utils/supabase/admin";

type CreateUserBody = {
  employee_id?: string;
  email?: string;
  password?: string;
  role?: string;
};

export async function POST(request: Request) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) {
    return auth.response;
  }

  let body: CreateUserBody;
  try {
    body = (await request.json()) as CreateUserBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { employee_id, email, password, role } = body;

  if (!employee_id || !email || !password || !role) {
    return NextResponse.json(
      { error: "employee_id, email, password, and role are required" },
      { status: 400 },
    );
  }

  if (password.length < 6) {
    return NextResponse.json(
      { error: "Password must be at least 6 characters" },
      { status: 400 },
    );
  }

  const admin = createAdminClient();

  const { data: existingAccount } = await admin
    .from("user_accounts")
    .select("auth_uid")
    .eq("employee_id", employee_id)
    .maybeSingle();

  if (existingAccount) {
    return NextResponse.json(
      { error: "This employee already has a user account" },
      { status: 409 },
    );
  }

  const { data: authData, error: authError } =
    await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

  if (authError || !authData.user) {
    return NextResponse.json(
      { error: authError?.message ?? "Failed to create auth user" },
      { status: 400 },
    );
  }

  const { error: insertError } = await admin.from("user_accounts").insert({
    auth_uid: authData.user.id,
    employee_id,
    role,
    email,
    is_active: true,
  });

  if (insertError) {
    await admin.auth.admin.deleteUser(authData.user.id);
    return NextResponse.json({ error: insertError.message }, { status: 400 });
  }

  return NextResponse.json({ auth_uid: authData.user.id });
}
