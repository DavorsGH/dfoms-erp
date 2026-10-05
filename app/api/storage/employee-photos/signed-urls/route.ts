import { NextResponse } from "next/server";
import {
  EMPLOYEE_PHOTO_SIGNED_URL_BATCH_MAX,
  resolveEmployeePhotoSignedUrlCaller,
  signEmployeePhotoUrlsForCaller,
} from "@/utils/employee-photos-signed-url-auth.server";

export const runtime = "nodejs";

type BatchBody = {
  employee_ids?: unknown;
};

export async function POST(request: Request) {
  const callerResult = await resolveEmployeePhotoSignedUrlCaller();
  if (!callerResult.ok) {
    return callerResult.response;
  }

  if (!callerResult.caller.isStaff) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let body: BatchBody;
  try {
    body = (await request.json()) as BatchBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const rawIds = body.employee_ids;
  if (!Array.isArray(rawIds)) {
    return NextResponse.json(
      { error: "employee_ids must be an array." },
      { status: 400 },
    );
  }

  const employeeIds = rawIds
    .filter((id): id is string => typeof id === "string")
    .map((id) => id.trim())
    .filter(Boolean);

  if (employeeIds.length === 0) {
    return NextResponse.json({});
  }

  if (employeeIds.length > EMPLOYEE_PHOTO_SIGNED_URL_BATCH_MAX) {
    return NextResponse.json(
      {
        error: `At most ${EMPLOYEE_PHOTO_SIGNED_URL_BATCH_MAX} employee_ids per request.`,
      },
      { status: 400 },
    );
  }

  const urls = await signEmployeePhotoUrlsForCaller(
    callerResult.caller,
    employeeIds,
  );

  return NextResponse.json(urls);
}
