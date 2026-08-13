import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { LandlordType } from "@/app/dashboard/real-estate/landlords-utils";
import { resolvePdfImageDataUrl } from "@/utils/pdf-image-source";
import { DAVORS_TENANT_ID } from "@/utils/tenant-signup";

export type RealEstatePdfSignature = {
  authorizedByName: string | null;
  authorizedByTitle: string | null;
  signatureImageUrl: string | null;
};

function asTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Resolve authorized-by block for Real Estate PDFs:
 * - platform_only → landlord's own signature_url / author fields
 * - davors_managed → Davors tenants.signature_url / author fields
 */
export async function resolveRealEstatePdfSignature(options: {
  supabase: SupabaseClient;
  landlordTenantId: string;
  landlordType?: LandlordType | null;
}): Promise<RealEstatePdfSignature> {
  const empty: RealEstatePdfSignature = {
    authorizedByName: null,
    authorizedByTitle: null,
    signatureImageUrl: null,
  };

  let landlordType = options.landlordType ?? null;
  if (!landlordType) {
    const { data: landlordRow } = await options.supabase
      .from("landlords")
      .select("landlord_type")
      .eq("tenant_id", options.landlordTenantId)
      .maybeSingle();
    landlordType =
      landlordRow?.landlord_type === "davors_managed"
        ? "davors_managed"
        : landlordRow?.landlord_type === "platform_only"
          ? "platform_only"
          : null;
  }

  if (!landlordType) {
    return empty;
  }

  const siteBaseUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim() || null;

  if (landlordType === "davors_managed") {
    const { data: davorsTenant, error } = await options.supabase
      .from("tenants")
      .select("signature_url, signature_author_name, signature_author_title")
      .eq("id", DAVORS_TENANT_ID)
      .maybeSingle();

    if (error) {
      console.error(
        "[real-estate-pdf-signature] Davors signature lookup failed:",
        error.message,
      );
      return empty;
    }

    const signatureReference = asTrimmedString(davorsTenant?.signature_url);
    let signatureImageUrl: string | null = null;
    if (signatureReference) {
      try {
        signatureImageUrl = await resolvePdfImageDataUrl({
          admin: options.supabase,
          reference: signatureReference,
          siteBaseUrl,
        });
      } catch (err) {
        console.error(
          "[real-estate-pdf-signature] Davors signature embed failed:",
          err instanceof Error ? err.message : err,
        );
      }
    }

    return {
      authorizedByName: asTrimmedString(davorsTenant?.signature_author_name),
      authorizedByTitle: asTrimmedString(davorsTenant?.signature_author_title),
      signatureImageUrl,
    };
  }

  const { data: landlord, error: landlordError } = await options.supabase
    .from("landlords")
    .select("signature_url, signature_author_name, signature_author_title")
    .eq("tenant_id", options.landlordTenantId)
    .maybeSingle();

  if (landlordError) {
    console.error(
      "[real-estate-pdf-signature] landlord signature lookup failed:",
      landlordError.message,
    );
    return empty;
  }

  const signatureReference = asTrimmedString(landlord?.signature_url);
  let signatureImageUrl: string | null = null;
  if (signatureReference) {
    try {
      signatureImageUrl = await resolvePdfImageDataUrl({
        admin: options.supabase,
        reference: signatureReference,
        siteBaseUrl,
      });
    } catch (err) {
      console.error(
        "[real-estate-pdf-signature] landlord signature embed failed:",
        err instanceof Error ? err.message : err,
      );
    }
  }

  return {
    authorizedByName: asTrimmedString(landlord?.signature_author_name),
    authorizedByTitle: asTrimmedString(landlord?.signature_author_title),
    signatureImageUrl,
  };
}

export function shouldShowRealEstatePdfSignatureBlock(
  signature: RealEstatePdfSignature,
): boolean {
  return Boolean(
    signature.authorizedByName ||
      signature.authorizedByTitle ||
      signature.signatureImageUrl,
  );
}
