import { NextResponse } from "next/server";
import { requireTenantRoleIn } from "@/utils/admin-auth";
import { renderBarcodeImage } from "@/utils/batch-label-utils";
import { INVENTORY_SECTION_ROLES } from "@/utils/rbac-access";

type BarcodeBody = {
  payload?: string;
};

export async function POST(request: Request) {
  const auth = await requireTenantRoleIn(INVENTORY_SECTION_ROLES);
  if (!auth.ok) {
    return auth.response;
  }

  let body: BarcodeBody;
  try {
    body = (await request.json()) as BarcodeBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const payload = typeof body.payload === "string" ? body.payload.trim() : "";
  if (!payload) {
    return NextResponse.json({ error: "payload is required." }, { status: 400 });
  }

  try {
    const dataUrl = await renderBarcodeImage(payload);
    return NextResponse.json({ data_url: dataUrl });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to render barcode.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
