import { NextResponse } from "next/server";
import { getCurrentTenantBranding } from "@/utils/tenant-branding";

export async function GET() {
  const branding = await getCurrentTenantBranding();
  const signatureUrl = branding.signatureImageUrl?.trim();

  if (!signatureUrl) {
    return NextResponse.json(
      { error: "No workspace signature image is configured." },
      { status: 404 },
    );
  }

  try {
    const response = await fetch(signatureUrl);
    if (!response.ok) {
      return NextResponse.json(
        { error: "Unable to load workspace signature image." },
        { status: 502 },
      );
    }

    const contentType = response.headers.get("content-type") || "image/png";
    const buffer = Buffer.from(await response.arrayBuffer());
    const dataUrl = `data:${contentType};base64,${buffer.toString("base64")}`;

    return NextResponse.json({ dataUrl });
  } catch {
    return NextResponse.json(
      { error: "Unable to load workspace signature image." },
      { status: 502 },
    );
  }
}
