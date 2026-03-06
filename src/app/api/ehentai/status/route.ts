import { NextResponse } from "next/server";
import { isConfigured } from "@/lib/ehentai-service";

export async function GET() {
  const configured = isConfigured();

  return NextResponse.json({
    configured,
  });
}
