import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const CONFIG_PATH = path.join(process.cwd(), ".cache", "ehentai-config.json");

export interface EHentaiConfig {
  memberId: string;
  passHash: string;
  igneous: string;
}

const DEFAULT_CONFIG: EHentaiConfig = {
  memberId: "",
  passHash: "",
  igneous: "",
};

export function loadEHentaiConfig(): EHentaiConfig {
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

function saveEHentaiConfig(config: EHentaiConfig) {
  const dir = path.dirname(CONFIG_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
}

export async function GET() {
  const config = loadEHentaiConfig();
  // Mask sensitive values for display
  return NextResponse.json({
    memberId: config.memberId ? config.memberId.slice(0, 3) + "***" : "",
    passHash: config.passHash ? config.passHash.slice(0, 6) + "***" : "",
    igneous: config.igneous ? config.igneous.slice(0, 4) + "***" : "",
    configured: !!(config.memberId && config.passHash),
  });
}

export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const current = loadEHentaiConfig();

    const updated: EHentaiConfig = {
      memberId: body.memberId !== undefined ? body.memberId : current.memberId,
      passHash: body.passHash !== undefined ? body.passHash : current.passHash,
      igneous: body.igneous !== undefined ? body.igneous : current.igneous,
    };

    saveEHentaiConfig(updated);

    return NextResponse.json({
      success: true,
      configured: !!(updated.memberId && updated.passHash),
    });
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to save E-Hentai settings", detail: String(err) },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  try {
    saveEHentaiConfig(DEFAULT_CONFIG);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to clear E-Hentai settings", detail: String(err) },
      { status: 500 }
    );
  }
}
