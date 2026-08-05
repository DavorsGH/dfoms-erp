import { NextResponse } from "next/server";
import { requirePlatformOnlyLandlordSession } from "@/utils/landlord-portal-auth";
import { uploadPropertyPhoto } from "@/utils/property-photo";
import { normalizePhotoUrls } from "@/app/dashboard/real-estate/properties-utils";

/**
 * platform_only: upload a property or unit photo for the landlord's own tenant.
 */
export async function POST(request: Request) {
  const auth = await requirePlatformOnlyLandlordSession();
  if (!auth.ok) {
    return auth.response;
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const entity = String(formData.get("entity") ?? "").trim();
  const entityId = String(formData.get("entity_id") ?? "").trim();
  const file = formData.get("file");

  if (entity !== "property" && entity !== "unit") {
    return NextResponse.json(
      { error: "entity must be property or unit." },
      { status: 400 },
    );
  }
  if (!entityId) {
    return NextResponse.json(
      { error: "entity_id is required" },
      { status: 400 },
    );
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }

  const tenantId = auth.session.tenantId;

  if (entity === "property") {
    const { data: property, error } = await auth.admin
      .from("properties")
      .select("property_id, photo_urls")
      .eq("tenant_id", tenantId)
      .eq("property_id", entityId)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (!property) {
      return NextResponse.json({ error: "Property not found." }, { status: 404 });
    }

    const uploadResult = await uploadPropertyPhoto(
      auth.admin,
      tenantId,
      "property",
      entityId,
      file,
    );
    if ("error" in uploadResult) {
      return NextResponse.json({ error: uploadResult.error }, { status: 400 });
    }

    const nextUrls = [
      ...normalizePhotoUrls(property.photo_urls),
      uploadResult.storagePath,
    ];

    const { error: updateError } = await auth.admin
      .from("properties")
      .update({
        photo_urls: nextUrls,
        updated_at: new Date().toISOString(),
      })
      .eq("tenant_id", tenantId)
      .eq("property_id", entityId);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      storagePath: uploadResult.storagePath,
      signedUrl: uploadResult.signedUrl,
      photo_urls: nextUrls,
    });
  }

  const { data: unit, error: unitError } = await auth.admin
    .from("property_units")
    .select("unit_id, photo_urls")
    .eq("tenant_id", tenantId)
    .eq("unit_id", entityId)
    .maybeSingle();

  if (unitError) {
    return NextResponse.json({ error: unitError.message }, { status: 400 });
  }
  if (!unit) {
    return NextResponse.json({ error: "Unit not found." }, { status: 404 });
  }

  const uploadResult = await uploadPropertyPhoto(
    auth.admin,
    tenantId,
    "unit",
    entityId,
    file,
  );
  if ("error" in uploadResult) {
    return NextResponse.json({ error: uploadResult.error }, { status: 400 });
  }

  const nextUrls = [
    ...normalizePhotoUrls(unit.photo_urls),
    uploadResult.storagePath,
  ];

  const { error: updateError } = await auth.admin
    .from("property_units")
    .update({
      photo_urls: nextUrls,
      updated_at: new Date().toISOString(),
    })
    .eq("tenant_id", tenantId)
    .eq("unit_id", entityId);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 400 });
  }

  return NextResponse.json({
    success: true,
    storagePath: uploadResult.storagePath,
    signedUrl: uploadResult.signedUrl,
    photo_urls: nextUrls,
  });
}
