import { NextResponse } from "next/server";
import { getSimulator } from "@/lib/mock/simulator";
import type { ScenarioId } from "@/lib/types";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    scenario?: ScenarioId;
    seed?: number;
    speed_multiplier?: number;
  };
  const sim = getSimulator();
  if (body.scenario) sim.controls.scenario = body.scenario;
  if (typeof body.speed_multiplier === "number") sim.controls.speed = body.speed_multiplier;
  sim.reset(body.seed ?? 42);
  sim.controls.playing = true;

  return NextResponse.json(
    {
      simulation_id: `sim-${sim.controls.seed}`,
      session_id: "sim-1",
      room_id: "room-1",
      mode: "simulation",
      stream_url: "/api/v1/rooms/room-1/sessions/sim-1/scene",
    },
    { status: 201 }
  );
}
