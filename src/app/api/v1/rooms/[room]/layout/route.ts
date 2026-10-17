import { NextResponse } from "next/server";
import { DEFAULT_LAYOUT } from "@/lib/layout";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ room: string }> }
) {
  const { room } = await ctx.params;
  return NextResponse.json({ ...DEFAULT_LAYOUT, room_id: room });
}
