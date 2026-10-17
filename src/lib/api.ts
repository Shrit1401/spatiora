import { DEFAULT_LAYOUT, ROOM_ID, SESSION_ID } from "./layout";
import { getSimulator } from "./mock/simulator";
import type {
  Capabilities,
  CsiWindow,
  HealthResponse,
  RoomLayout,
  ScenarioId,
  SceneSnapshot,
  SignalHistory,
  SimControls,
} from "./types";

const EXTERNAL = process.env.NEXT_PUBLIC_API_BASE?.replace(/\/$/, "") || "";

function base() {
  // Same-origin Next routes by default; optional external backend later
  return EXTERNAL || "";
}

async function getJson<T>(path: string, fallback: () => T): Promise<T> {
  try {
    const res = await fetch(`${base()}${path}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`${res.status}`);
    return (await res.json()) as T;
  } catch {
    return fallback();
  }
}

export async function fetchHealth(): Promise<HealthResponse> {
  return getJson("/api/v1/health", () => ({
    ok: true,
    service: "spatiora-fallback",
    build: "offline-mock",
    mode: "simulation" as const,
    time: new Date().toISOString(),
  }));
}

export async function fetchLayout(room = ROOM_ID): Promise<RoomLayout> {
  return getJson(`/api/v1/rooms/${room}/layout`, () => ({
    ...DEFAULT_LAYOUT,
    room_id: room,
  }));
}

export async function fetchCapabilities(
  room = ROOM_ID,
  session = SESSION_ID
): Promise<Capabilities> {
  return getJson(
    `/api/v1/rooms/${room}/sessions/${session}/capabilities`,
    () => getSimulator().getCapabilities()
  );
}

export async function fetchScene(
  room = ROOM_ID,
  session = SESSION_ID
): Promise<SceneSnapshot> {
  return getJson(`/api/v1/rooms/${room}/sessions/${session}/scene`, () => {
    const sim = getSimulator();
    sim.tick(0.05);
    return sim.getScene();
  });
}

export async function fetchSignals(
  linkId: string,
  room = ROOM_ID,
  session = SESSION_ID
): Promise<SignalHistory> {
  return getJson(
    `/api/v1/rooms/${room}/sessions/${session}/signals?link_id=${encodeURIComponent(linkId)}`,
    () => getSimulator().getSignalHistory(linkId)
  );
}

export async function fetchCsiWindow(
  room = ROOM_ID,
  session = SESSION_ID
): Promise<CsiWindow> {
  return getJson(
    `/api/v1/rooms/${room}/sessions/${session}/csi-window`,
    () => getSimulator().getCsiWindow()
  );
}

export async function patchSimulation(
  id: string,
  body: {
    action?: "pause" | "resume" | "reset";
    speed_multiplier?: number;
    scenario?: ScenarioId;
  }
): Promise<{ controls: SimControls }> {
  try {
    const res = await fetch(`${base()}/api/v1/simulations/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(String(res.status));
    return (await res.json()) as { controls: SimControls };
  } catch {
    const sim = getSimulator();
    if (body.action === "pause") sim.controls.playing = false;
    if (body.action === "resume") sim.controls.playing = true;
    if (body.action === "reset") sim.reset();
    if (typeof body.speed_multiplier === "number") sim.controls.speed = body.speed_multiplier;
    if (body.scenario) sim.controls.scenario = body.scenario;
    return { controls: { ...sim.controls } };
  }
}
