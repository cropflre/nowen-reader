// Copy frontend build output to web/dist/ for Go embedding
import { cpSync, rmSync, mkdirSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = resolve(__dirname, "../dist");
const dest = resolve(__dirname, "../../web/dist");

if (!existsSync(src)) {
  console.error("❌ Build output not found at", src);
  console.error("   Run 'npm run build' first.");
  process.exit(1);
}

// Clean destination
if (existsSync(dest)) {
  rmSync(dest, { recursive: true });
}
mkdirSync(dest, { recursive: true });

// Copy
cpSync(src, dest, { recursive: true });

console.log("✅ Frontend build copied to web/dist/");
