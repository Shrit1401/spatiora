import { NextResponse } from "next/server";
import { getSimulator } from "@/lib/mock/simulator";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ room: string; session: string }> }
) {
  await ctx.params;
  const url = new URL(req.url);
  const linkId = url.searchParams.get("link_id") || "b1-b2";
  const sim = getSimulator();
  return NextResponse.json(sim.getSignalHistory(linkId));
}
