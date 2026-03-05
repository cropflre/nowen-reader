import { NextResponse } from "next/server";
import { getAIStatus } from "@/lib/ai-service";

export async function GET() {
  try {
    const status = getAIStatus();
    return NextResponse.json(status);
  } catch (err) {
    console.error("Failed to get AI status:", err);
    return NextResponse.json({ error: "Failed to get status" }, { status: 500 });
  }
}
