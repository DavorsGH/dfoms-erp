import "server-only";

import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export const RENTAL_APPLICATION_LINK_EXPIRY_DAYS = 30;

export function hashRentalApplicationToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

export function generateRentalApplicationRawToken(): string {
  return randomBytes(32).toString("hex");
}

function siteBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    "https://portal.davorsfacilities.com"
  );
}

export function buildRentalApplicationUrl(rawToken: string): string {
  return `${siteBaseUrl().replace(/\/$/, "")}/apply/${encodeURIComponent(rawToken)}`;
}

/**
 * Creates a shareable apply link for a vacant unit. Revokes prior active links
 * for the same unit so only the newest token works.
 */
export async function createRentalApplicationLink(
  admin: SupabaseClient,
  args: {
    tenantId: string;
    propertyId: string;
    unitId: string;
    createdBy: string | null;
    expiryDays?: number;
  },
): Promise<
  | { ok: true; linkId: string; url: string; expiresAt: string }
  | { ok: false; error: string; status: number }
> {
  const { data: unit, error: unitError } = await admin
    .from("property_units")
    .select("unit_id, property_id, status")
    .eq("tenant_id", args.tenantId)
    .eq("unit_id", args.unitId)
    .maybeSingle();

  if (unitError) {
    return { ok: false, error: unitError.message, status: 400 };
  }
  if (!unit) {
    return { ok: false, error: "Unit not found.", status: 404 };
  }
  if (unit.status !== "vacant") {
    return {
      ok: false,
      error: "Apply links can only be created for vacant units.",
      status: 400,
    };
  }
  if (unit.property_id !== args.propertyId) {
    return {
      ok: false,
      error: "property_id does not match the unit.",
      status: 400,
    };
  }

  const now = new Date();
  const expiresAt = new Date(
    now.getTime() +
      (args.expiryDays ?? RENTAL_APPLICATION_LINK_EXPIRY_DAYS) *
        24 *
        60 *
        60 *
        1000,
  );
  const rawToken = generateRentalApplicationRawToken();
  const tokenHash = hashRentalApplicationToken(rawToken);
  const linkId = crypto.randomUUID();

  // Revoke prior active links for this unit.
  await admin
    .from("rental_application_links")
    .update({ revoked_at: now.toISOString() })
    .eq("tenant_id", args.tenantId)
    .eq("unit_id", args.unitId)
    .is("revoked_at", null);

  const { error: insertError } = await admin
    .from("rental_application_links")
    .insert({
      link_id: linkId,
      tenant_id: args.tenantId,
      property_id: args.propertyId,
      unit_id: args.unitId,
      token_hash: tokenHash,
      expires_at: expiresAt.toISOString(),
      revoked_at: null,
      created_by: args.createdBy,
      created_at: now.toISOString(),
    });

  if (insertError) {
    return { ok: false, error: insertError.message, status: 400 };
  }

  return {
    ok: true,
    linkId,
    url: buildRentalApplicationUrl(rawToken),
    expiresAt: expiresAt.toISOString(),
  };
}

export type RentalApplicationLinkContext = {
  linkId: string;
  tenantId: string;
  propertyId: string;
  unitId: string;
  propertyName: string;
  unitNumber: string;
  baseRentGhs: number;
  unitStatus: string;
  expiresAt: string;
};

export async function resolveRentalApplicationLink(
  admin: SupabaseClient,
  rawToken: string,
): Promise<
  | { ok: true; context: RentalApplicationLinkContext }
  | { ok: false; error: string; status: number }
> {
  const token = rawToken.trim();
  if (!token) {
    return { ok: false, error: "Invalid application link.", status: 400 };
  }

  const tokenHash = hashRentalApplicationToken(token);
  const { data: link, error: linkError } = await admin
    .from("rental_application_links")
    .select(
      "link_id, tenant_id, property_id, unit_id, expires_at, revoked_at",
    )
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (linkError) {
    return { ok: false, error: linkError.message, status: 400 };
  }
  if (!link) {
    return { ok: false, error: "Application link not found.", status: 404 };
  }
  if (link.revoked_at) {
    return {
      ok: false,
      error: "This application link has been revoked.",
      status: 410,
    };
  }
  if (new Date(link.expires_at).getTime() < Date.now()) {
    return {
      ok: false,
      error: "This application link has expired.",
      status: 410,
    };
  }

  const [{ data: unit }, { data: property }] = await Promise.all([
    admin
      .from("property_units")
      .select("unit_id, unit_number, base_rent_ghs, status")
      .eq("tenant_id", link.tenant_id)
      .eq("unit_id", link.unit_id)
      .maybeSingle(),
    admin
      .from("properties")
      .select("property_id, name")
      .eq("tenant_id", link.tenant_id)
      .eq("property_id", link.property_id)
      .maybeSingle(),
  ]);

  if (!unit) {
    return { ok: false, error: "Unit not found for this link.", status: 404 };
  }

  return {
    ok: true,
    context: {
      linkId: link.link_id,
      tenantId: link.tenant_id,
      propertyId: link.property_id,
      unitId: link.unit_id,
      propertyName: property?.name?.trim() || "Property",
      unitNumber: unit.unit_number?.trim() || "—",
      baseRentGhs: Number(unit.base_rent_ghs) || 0,
      unitStatus: unit.status,
      expiresAt: link.expires_at,
    },
  };
}
