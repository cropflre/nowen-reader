import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const CONFIG_PATH = path.join(process.cwd(), ".cache", "site-config.json");

export interface SiteConfig {
  siteName: string;
  comicsDir: string;
  extraComicsDirs: string[];
  thumbnailWidth: number;
  thumbnailHeight: number;
  pageSize: number;
  language: string;
  theme: string;
}

const DEFAULT_CONFIG: SiteConfig = {
  siteName: "NowenReader",
  comicsDir: process.env.COMICS_DIR || path.join(process.cwd(), "comics"),
  extraComicsDirs: [],
  thumbnailWidth: 400,
  thumbnailHeight: 560,
  pageSize: 24,
  language: "auto",
  theme: "dark",
};

function loadSiteConfig(): SiteConfig {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
      return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
    }
  } catch {
    // ignore
  }
  return { ...DEFAULT_CONFIG };
}

function saveSiteConfig(config: SiteConfig) {
  const dir = path.dirname(CONFIG_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
}

export async function GET() {
  const config = loadSiteConfig();
  return NextResponse.json(config);
}

export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const current = loadSiteConfig();

    const updated: SiteConfig = {
      siteName: body.siteName ?? current.siteName,
      comicsDir: body.comicsDir ?? current.comicsDir,
      extraComicsDirs: Array.isArray(body.extraComicsDirs) ? body.extraComicsDirs : current.extraComicsDirs,
      thumbnailWidth: Number(body.thumbnailWidth) || current.thumbnailWidth,
      thumbnailHeight: Number(body.thumbnailHeight) || current.thumbnailHeight,
      pageSize: Number(body.pageSize) || current.pageSize,
      language: body.language ?? current.language,
      theme: body.theme ?? current.theme,
    };

    saveSiteConfig(updated);
    return NextResponse.json({ success: true, config: updated });
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to save settings", detail: String(err) },
      { status: 500 }
    );
  }
}
