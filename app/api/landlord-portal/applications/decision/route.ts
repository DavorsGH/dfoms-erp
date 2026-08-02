import { NextResponse } from "next/server";
import { requireApprovedLandlordSession } from "@/utils/landlord-portal-auth";
import { decideRentalApplication } from "@/utils/rental-application-management";

type Body = {
  application_id?: string;
  decision?: "approve" | "reject" | "request_info" | "under_review";
  landlord_notes?: string | null;
  decision_reason?: string | null;
  info_request_message?: string | null;
};

/**
 * Both landlord types may approve / reject / request info (exception to
 * davors_managed view-only). No staff approval step.
 */
export async function POST(request: Request) {
  const auth = await requireApprovedLandlordSession();
  if (!auth.ok) {
    return auth.response;
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const applicationId = body.application_id?.trim() ?? "";
  if (!applicationId) {
    return NextResponse.json(
      { error: "application_id is required" },
      { status: 400 },
    );
  }

  const decision = body.decision;
  if (
    decision !== "approve" &&
    decision !== "reject" &&
    decision !== "request_info" &&
    decision !== "under_review"
  ) {
    return NextResponse.json(
      {
        error:
          "decision must be approve, reject, request_info, or under_review.",
      },
      { status: 400 },
    );
  }

  let decisionBody;
  if (decision === "approve") {
    decisionBody = {
      decision: "approve" as const,
      landlordNotes: body.landlord_notes,
    };
  } else if (decision === "reject") {
    decisionBody = {
      decision: "reject" as const,
      decisionReason: body.decision_reason,
      landlordNotes: body.landlord_notes,
    };
  } else if (decision === "request_info") {
    decisionBody = {
      decision: "request_info" as const,
      infoRequestMessage: body.info_request_message ?? "",
      landlordNotes: body.landlord_notes,
    };
  } else {
    decisionBody = {
      decision: "under_review" as const,
      landlordNotes: body.landlord_notes,
    };
  }

  const result = await decideRentalApplication(auth.admin, {
    tenantId: auth.session.tenantId,
    applicationId,
    decidedBy: auth.session.authUserId,
    body: decisionBody,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ success: true, status: result.status });
}
