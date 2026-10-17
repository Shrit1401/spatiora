import { NextResponse } from "next/server";
import { getSimulator } from "@/lib/mock/simulator";
import type { ScenarioId } from "@/lib/types";

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as {
    action?: "pause" | "resume" | "reset";
    speed_multiplier?: number;
    scenario?: ScenarioId;
  };
  const sim = getSimulator();

  if (body.action === "pause") sim.controls.playing = false;
  if (body.action === "resume") sim.controls.playing = true;
  if (body.action === "reset") sim.reset();
  if (typeof body.speed_multiplier === "number") sim.controls.speed = body.speed_multiplier;
  if (body.scenario) sim.controls.scenario = body.scenario;

  return NextResponse.json({
    simulation_id: id,
    controls: sim.controls,
  });
}
