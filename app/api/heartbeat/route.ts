import { NextResponse } from "next/server";
import { createAdminClient } from "@/utils/supabase/admin";

export async function GET() {
  console.log("heartbeat ping");

  try {
    const supabase = createAdminClient();
    const { error } = await supabase.from("employees").select("id").limit(1);

    if (error) {
      return NextResponse.json(
        { status: "error", message: error.message },
        { status: 500 },
      );
    }

    return NextResponse.json({
      status: "ok",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Heartbeat check failed";

    return NextResponse.json({ status: "error", message }, { status: 500 });
  }
}
