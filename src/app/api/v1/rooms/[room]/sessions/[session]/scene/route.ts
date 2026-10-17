import { NextResponse } from "next/server";
import { getSimulator } from "@/lib/mock/simulator";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ room: string; session: string }> }
) {
  const { room, session } = await ctx.params;
  const sim = getSimulator();
  // Advance sim with wall-clock so REST polls at any rate stay smooth
  const now = Date.now();
  const g = globalThis as unknown as { __spatioraLastTick?: number };
  const last = g.__spatioraLastTick ?? now;
  const dt = Math.min(0.25, Math.max(0, (now - last) / 1000));
  g.__spatioraLastTick = now;
  sim.tick(dt);
  const scene = sim.getScene();
  return NextResponse.json({ ...scene, room_id: room, session_id: session });
}
