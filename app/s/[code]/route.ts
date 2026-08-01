import { NextResponse } from "next/server";
import {
  lookupShortLinkDestination,
  resolveDestinationRedirectUrl,
} from "@/utils/short-links";

type RouteContext = {
  params: Promise<{ code: string }>;
};

/**
 * Public short-link redirect. Looks up `short_links.code` and 302s to the
 * stored destination_url as-is (absolute preferred). Missing/expired → 404.
 * Does not fall back to /dashboard.
 */
export async function GET(_request: Request, context: RouteContext) {
  const { code: rawCode } = await context.params;
  const code = rawCode?.trim() ?? "";

  if (!code || code.length > 32 || !/^[A-Za-z0-9_-]+$/.test(code)) {
    return new NextResponse("Not found", { status: 404 });
  }

  try {
    const destination = await lookupShortLinkDestination(code);
    if (!destination) {
      return new NextResponse("Not found", { status: 404 });
    }

    const target = resolveDestinationRedirectUrl(destination);
    return NextResponse.redirect(target, 302);
  } catch (error) {
    console.error(
      "[short-links] redirect failed:",
      error instanceof Error ? error.message : error,
    );
    return new NextResponse("Not found", { status: 404 });
  }
}
