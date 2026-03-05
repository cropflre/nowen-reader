import { NextResponse } from "next/server";
import { detectDuplicates } from "@/lib/comic-service";

export async function GET() {
  try {
    const groups = await detectDuplicates();
    return NextResponse.json({ groups, total: groups.length });
  } catch (err) {
    console.error("Failed to detect duplicates:", err);
    return NextResponse.json(
      { error: "Failed to detect duplicates" },
      { status: 500 }
    );
  }
}
