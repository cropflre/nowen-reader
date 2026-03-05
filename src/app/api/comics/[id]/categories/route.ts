import { NextRequest, NextResponse } from "next/server";
import { addCategoriesToComic, removeCategoryFromComic, setComicCategories } from "@/lib/comic-service";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { categorySlugs } = await request.json();

    if (!Array.isArray(categorySlugs)) {
      return NextResponse.json({ error: "categorySlugs array required" }, { status: 400 });
    }

    await addCategoriesToComic(id, categorySlugs);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Failed to add categories:", err);
    return NextResponse.json({ error: "Failed to add categories" }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { categorySlugs } = await request.json();

    if (!Array.isArray(categorySlugs)) {
      return NextResponse.json({ error: "categorySlugs array required" }, { status: 400 });
    }

    await setComicCategories(id, categorySlugs);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Failed to set categories:", err);
    return NextResponse.json({ error: "Failed to set categories" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { categorySlug } = await request.json();

    if (!categorySlug) {
      return NextResponse.json({ error: "categorySlug required" }, { status: 400 });
    }

    await removeCategoryFromComic(id, categorySlug);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Failed to remove category:", err);
    return NextResponse.json({ error: "Failed to remove category" }, { status: 500 });
  }
}
