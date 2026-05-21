import {
  GET as adminGet,
  POST as adminPost,
} from "@/app/api/admin/export/google-drive/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  return adminGet(req);
}

export async function POST(req: Request) {
  return adminPost(req);
}
