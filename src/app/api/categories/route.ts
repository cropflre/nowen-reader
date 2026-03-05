import { NextRequest, NextResponse } from "next/server";
import { getAllCategories, initCategories } from "@/lib/comic-service";

export async function GET() {
  try {
    const categories = await getAllCategories();
    return NextResponse.json({ categories });
  } catch (err) {
    console.error("Failed to fetch categories:", err);
    return NextResponse.json(
      { error: "Failed to fetch categories" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const { lang } = await request.json().catch(() => ({ lang: "zh" }));
    await initCategories(lang);
    const categories = await getAllCategories();
    return NextResponse.json({ categories });
  } catch (err) {
    console.error("Failed to init categories:", err);
    return NextResponse.json(
      { error: "Failed to init categories" },
      { status: 500 }
    );
  }
}
