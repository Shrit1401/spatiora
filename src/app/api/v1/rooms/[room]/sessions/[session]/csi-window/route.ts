import { NextResponse } from "next/server";
import { getSimulator } from "@/lib/mock/simulator";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ room: string; session: string }> }
) {
  await ctx.params;
  return NextResponse.json(getSimulator().getCsiWindow());
}
