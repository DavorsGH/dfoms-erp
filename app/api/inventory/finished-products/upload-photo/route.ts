import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireTenantRoleIn } from "@/utils/admin-auth";
import { uploadFinishedProductPhoto } from "@/utils/finished-product-photo";
import { INVENTORY_EDIT_ROLES } from "@/utils/rbac-access";
import { createAdminClient } from "@/utils/supabase/admin";
import { createClient } from "@/utils/supabase/server";

async function getTenantSupabase() {
  const cookieStore = await cookies();
  return createClient(cookieStore);
}

export async function POST(request: Request) {
  const auth = await requireTenantRoleIn(INVENTORY_EDIT_ROLES);
  if (!auth.ok) {
    return auth.response;
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data." }, { status: 400 });
  }

  const productId = String(formData.get("product_id") ?? "").trim();
  const file = formData.get("file");

  if (!productId) {
    return NextResponse.json({ error: "product_id is required." }, { status: 400 });
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file is required." }, { status: 400 });
  }

  const supabase = await getTenantSupabase();
  const { data: product, error: productError } = await supabase
    .from("finished_products")
    .select("id")
    .eq("id", productId)
    .eq("tenant_id", auth.tenantId)
    .maybeSingle();

  if (productError) {
    return NextResponse.json({ error: productError.message }, { status: 400 });
  }
  if (!product) {
    return NextResponse.json({ error: "Finished product not found." }, { status: 404 });
  }

  const admin = createAdminClient();
  const uploadResult = await uploadFinishedProductPhoto(
    admin,
    auth.tenantId,
    productId,
    file,
  );

  if ("error" in uploadResult) {
    return NextResponse.json({ error: uploadResult.error }, { status: 400 });
  }

  const { error: updateError } = await supabase
    .from("finished_products")
    .update({
      photo_url: uploadResult.storagePath,
      updated_at: new Date().toISOString(),
    })
    .eq("id", productId)
    .eq("tenant_id", auth.tenantId);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 400 });
  }

  return NextResponse.json({
    success: true,
    photo_url: uploadResult.storagePath,
    signedUrl: uploadResult.signedUrl,
  });
}
