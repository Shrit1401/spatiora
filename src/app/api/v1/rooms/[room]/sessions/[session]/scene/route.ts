import { NextResponse } from "next/server";
import { getSimulator } from "@/lib/mock/simulator";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ room: string; session: string }> }
) {
  const { room, session } = await ctx.params;
  const sim = getSimulator();
  // Advance sim a bit each poll so REST clients see motion
  sim.tick(0.05);
  const scene = sim.getScene();
  return NextResponse.json({ ...scene, room_id: room, session_id: session });
}
