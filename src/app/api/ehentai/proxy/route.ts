import { NextRequest, NextResponse } from "next/server";
import { fetchImageStream } from "@/lib/ehentai-service";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const imageUrl = searchParams.get("url");

  if (!imageUrl) {
    return new NextResponse("Missing image URL", { status: 400 });
  }

  // Basic validation: only proxy known image domains
  try {
    const urlObj = new URL(imageUrl);
    const allowedHosts = [
      "ehgt.org",
      "exhentai.org",
      "e-hentai.org",
      "hath.network",
    ];
    const isAllowed = allowedHosts.some(
      (h) => urlObj.hostname === h || urlObj.hostname.endsWith(`.${h}`)
    );
    if (!isAllowed) {
      return new NextResponse("URL domain not allowed", { status: 403 });
    }
  } catch {
    return new NextResponse("Invalid URL", { status: 400 });
  }

  try {
    const { body, contentType, contentLength } =
      await fetchImageStream(imageUrl);

    if (!body) {
      return new NextResponse("Empty response body", { status: 502 });
    }

    const headers = new Headers();
    headers.set("Content-Type", contentType);
    if (contentLength) headers.set("Content-Length", contentLength);
    headers.set("Cache-Control", "public, max-age=86400"); // cache 1 day
    headers.set("Access-Control-Allow-Origin", "*");

    return new NextResponse(body, { status: 200, headers });
  } catch (error) {
    console.error("[ehentai/proxy] Error:", error);
    return new NextResponse("Error fetching image", { status: 502 });
  }
}
