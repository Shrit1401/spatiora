import { NextResponse } from "next/server";
import { getSimulator } from "@/lib/mock/simulator";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ room: string; session: string }> }
) {
  const { room, session } = await ctx.params;
  const sim = getSimulator();
  const caps = sim.getCapabilities();
  return NextResponse.json({ ...caps, room_id: room, session_id: session });
}
