import { NextResponse } from "next/server";
import { runPlatformSignOut } from "@/lib/auth/platform-sign-out-core";

export async function POST() {
  try {
    await runPlatformSignOut();
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[auth/sign-out] failed:", error);
    return NextResponse.json(
      { error: "Unable to sign out. Please try again." },
      { status: 500 },
    );
  }
}
