import { config } from "dotenv";
import fs from "node:fs/promises";
import path from "node:path";
import Module from "node:module";

// Allow local Node scripts to import project files that contain `import "server-only"`.
// Do not remove `server-only` from the real app files.
const originalLoad = (Module as any)._load;
(Module as any)._load = function patchedLoad(
  request: string,
  parent: any,
  isMain: boolean
) {
  if (request === "server-only") {
    return {};
  }

  return originalLoad.apply(this, arguments as any);
};

config({ path: path.resolve(process.cwd(), ".env.local") });

const EXPORT_TIME_ZONE = "Asia/Dubai";

function getDubaiDateParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: EXPORT_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "00";

  return {
    yyyy: get("year"),
    mm: get("month"),
    dd: get("day"),
    hh: get("hour"),
    min: get("minute"),
  };
}

function safeDateName(date = new Date()) {
  const { yyyy, mm, dd, hh, min } = getDubaiDateParts(date);
  return `${yyyy}-${mm}-${dd} ${hh}-${min} UAE`;
}

async function main() {
  const requiredEnv = [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
  ];

  const missing = requiredEnv.filter((key) => !process.env[key]);

  if (missing.length) {
    throw new Error(
      `Missing required environment variables in .env.local: ${missing.join(", ")}`
    );
  }

  const { buildReadySubmissionsWorkbookBuffer } = await import(
    "../lib/export-workbooks"
  );

  console.log("Building Ready Submissions workbook locally...");
  console.log("This does not use Vercel CPU.");

  const buffer = await buildReadySubmissionsWorkbookBuffer();

  const exportsDir = path.resolve(process.cwd(), "exports");
  await fs.mkdir(exportsDir, { recursive: true });

  const fileName = `Ready Submissions - ${safeDateName()}.xlsx`;
  const filePath = path.join(exportsDir, fileName);

  await fs.writeFile(filePath, buffer);

  console.log("");
  console.log("Done.");
  console.log(`Saved file: ${filePath}`);
}

main().catch((error) => {
  console.error("");
  console.error("Ready Submissions local export failed:");
  console.error(error);
  process.exit(1);
});