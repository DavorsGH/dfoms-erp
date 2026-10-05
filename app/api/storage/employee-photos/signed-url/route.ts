import { NextResponse } from "next/server";
import {
  resolveEmployeePhotoSignedUrlCaller,
  signEmployeePhotoUrlsForCaller,
} from "@/utils/employee-photos-signed-url-auth.server";
import { EMPLOYEE_PHOTOS_SIGNED_URL_TTL_SECONDS } from "@/utils/employee-photos-storage";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const callerResult = await resolveEmployeePhotoSignedUrlCaller();
  if (!callerResult.ok) {
    return callerResult.response;
  }

  const { searchParams } = new URL(request.url);
  const employeeId = searchParams.get("employee_id")?.trim() ?? "";
  if (!employeeId) {
    return NextResponse.json(
      { error: "employee_id is required." },
      { status: 400 },
    );
  }

  const urls = await signEmployeePhotoUrlsForCaller(
    callerResult.caller,
    [employeeId],
  );
  const signedUrl = urls[employeeId];
  if (!signedUrl) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  return NextResponse.json({
    signedUrl,
    expiresIn: EMPLOYEE_PHOTOS_SIGNED_URL_TTL_SECONDS,
  });
}
