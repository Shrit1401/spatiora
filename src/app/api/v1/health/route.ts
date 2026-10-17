import { NextResponse } from "next/server";
import type { HealthResponse } from "@/lib/types";

export async function GET() {
  const body: HealthResponse = {
    ok: true,
    service: "spatiora-mock",
    build: "sim-1.0",
    mode: "simulation",
    time: new Date().toISOString(),
  };
  return NextResponse.json(body);
}
