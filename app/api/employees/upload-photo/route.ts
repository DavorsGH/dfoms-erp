import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ROUTE_HANDLER_AUTH_OPTS } from "@/lib/middleware-trust-policy";
import { requireAuthenticated } from "@/utils/admin-auth";
import { getCurrentUserTenantId } from "@/utils/dashboard-auth";
import { EMPLOYEE_PHOTO_UPLOAD_USER_MESSAGE } from "@/utils/employee-photo";
import { uploadEmployeePhotoServer } from "@/utils/employee-photo-upload.server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await requireAuthenticated();
  if (!auth.ok) {
    return auth.response;
  }

  const tenantId = await getCurrentUserTenantId(ROUTE_HANDLER_AUTH_OPTS);
  if (!tenantId) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data." }, { status: 400 });
  }

  const employeeId = String(formData.get("employee_id") ?? "").trim();
  const file = formData.get("file");
  if (!employeeId) {
    return NextResponse.json({ error: "employee_id is required." }, { status: 400 });
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file is required." }, { status: 400 });
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data: employee, error: employeeError } = await supabase
    .from("employees")
    .select("employee_id")
    .eq("tenant_id", tenantId)
    .eq("employee_id", employeeId)
    .maybeSingle();

  if (employeeError) {
    console.error(
      "[employees/upload-photo] employee lookup failed:",
      employeeError.message,
    );
    return NextResponse.json(
      { error: EMPLOYEE_PHOTO_UPLOAD_USER_MESSAGE },
      { status: 400 },
    );
  }
  if (!employee) {
    return NextResponse.json({ error: "Employee not found." }, { status: 404 });
  }

  const uploadResult = await uploadEmployeePhotoServer(
    supabase,
    tenantId,
    employeeId,
    file,
  );

  if ("error" in uploadResult) {
    return NextResponse.json(
      { error: uploadResult.error },
      { status: 400 },
    );
  }

  return NextResponse.json({
    success: true,
    storagePath: uploadResult.storagePath,
    photo_url: uploadResult.storagePath,
  });
}
