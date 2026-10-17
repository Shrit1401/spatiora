import { DEFAULT_LAYOUT, SUBCARRIER_INDICES } from "../layout";
import type {
  Capabilities,
  CsiWindow,
  LinkMetrics,
  OccupancyState,
  ScenarioId,
  SceneSnapshot,
  SignalHistory,
  SignalHistoryPoint,
  SimControls,
  Track,
} from "../types";

type Vec2 = { x: number; y: number };

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function distToSegment(p: Vec2, a: Vec2, b: Vec2) {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const len2 = abx * abx + aby * aby;
  if (len2 < 1e-9) return Math.hypot(p.x - a.x, p.y - a.y);
  const u = clamp(((p.x - a.x) * abx + (p.y - a.y) * aby) / len2, 0, 1);
  const nx = a.x + u * abx;
  const ny = a.y + u * aby;
  return Math.hypot(p.x - nx, p.y - ny);
}

/** Walk-across-triangle waypoints (contract §11.2). */
const WALK_PATH: Array<{ t: number; p: Vec2 }> = [
  { t: 0, p: { x: 1.0, y: 0.6 } },
  { t: 10, p: { x: 2.8, y: 0.6 } },
  { t: 20, p: { x: 2.0, y: 2.4 } },
  { t: 30, p: { x: 1.0, y: 0.6 } },
];

function pathAt(path: typeof WALK_PATH, t: number): { pos: Vec2; vel: Vec2; heading: number } {
  const cycle = ((t % 30) + 30) % 30;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    if (cycle >= a.t && cycle <= b.t) {
      const u = (cycle - a.t) / (b.t - a.t || 1);
      const pos = { x: lerp(a.p.x, b.p.x, u), y: lerp(a.p.y, b.p.y, u) };
      const dt = b.t - a.t || 1;
      const vel = { x: (b.p.x - a.p.x) / dt, y: (b.p.y - a.p.y) / dt };
      const heading = Math.atan2(vel.y, vel.x);
      return { pos, vel, heading };
    }
  }
  const last = path[path.length - 1].p;
  return { pos: last, vel: { x: 0, y: 0 }, heading: 0 };
}

const boardPos = (id: string): Vec2 => {
  const b = DEFAULT_LAYOUT.boards.find((x) => x.board_id === id)!;
  return { x: b.position_m[0], y: b.position_m[1] };
};

const B1 = boardPos("b1");
const B2 = boardPos("b2");
const B3 = boardPos("b3");

export class SensingSimulator {
  controls: SimControls = {
    playing: true,
    speed: 1,
    scenario: "walk_across_triangle",
    seed: 42,
  };

  private simTime = 0;
  private sequence = 0;
  private streamId = "stream-sim-1-a";
  private history: Record<string, SignalHistoryPoint[]> = {
    "b1-b2": [],
    "b1-b3": [],
  };
  private lastAmp: Record<string, number[]> = {
    "b1-b2": Array(51).fill(1),
    "b1-b3": Array(51).fill(1),
  };
  private rand = mulberry32(42);
  private roomId: string;
  private sessionId: string;

  constructor(roomId = "room-1", sessionId = "sim-1") {
    this.roomId = roomId;
    this.sessionId = sessionId;
  }

  reset(seed = this.controls.seed) {
    this.controls.seed = seed;
    this.rand = mulberry32(seed);
    this.simTime = 0;
    this.sequence = 0;
    this.streamId = `stream-sim-${seed}-${Date.now().toString(36)}`;
    this.history = { "b1-b2": [], "b1-b3": [] };
  }

  tick(dtWall: number) {
    if (!this.controls.playing) return;
    this.simTime += dtWall * this.controls.speed;
  }

  getCapabilities(): Capabilities {
    return {
      schema_version: "1.0",
      room_id: this.roomId,
      session_id: this.sessionId,
      mode: "simulation",
      features: {
        rssi: "simulated",
        normalized_csi: "simulated",
        raw_csi: "unavailable",
        phase: "unavailable",
        presence: "simulated",
        motion: "simulated",
        position_2d: "simulated",
        position_3d: "unavailable",
        pose: "unavailable",
        person_count: "simulated",
      },
      link_ids: ["b1-b2", "b1-b3"],
      max_tracks: 1,
      observed_telemetry_rate_hz: 20,
      observed_scene_rate_hz: 20,
      quality_policy: { csi_stale_after_ms: 2000, node_stale_after_ms: 3000 },
      limitations: ["Synthetic simulation — not hardware measurements."],
    };
  }

  private personState(): {
    present: boolean;
    motion: boolean;
    pos: Vec2 | null;
    vel: Vec2 | null;
    heading: number | null;
  } {
    const s = this.controls.scenario;
    if (s === "empty") {
      return { present: false, motion: false, pos: null, vel: null, heading: null };
    }
    if (s === "stand_still") {
      return {
        present: true,
        motion: false,
        pos: { x: 2.0, y: 1.4 },
        vel: { x: 0, y: 0 },
        heading: 0.4,
      };
    }
    if (s === "enter_pause_leave") {
      const t = ((this.simTime % 24) + 24) % 24;
      if (t < 3) return { present: false, motion: false, pos: null, vel: null, heading: null };
      if (t < 8) {
        const u = (t - 3) / 5;
        return {
          present: true,
          motion: true,
          pos: { x: lerp(0.3, 2.0, u), y: lerp(0.2, 1.4, u) },
          vel: { x: 0.34, y: 0.24 },
          heading: Math.atan2(0.24, 0.34),
        };
      }
      if (t < 14) {
        return {
          present: true,
          motion: false,
          pos: { x: 2.0, y: 1.4 },
          vel: { x: 0, y: 0 },
          heading: 0.4,
        };
      }
      if (t < 19) {
        const u = (t - 14) / 5;
        return {
          present: true,
          motion: true,
          pos: { x: lerp(2.0, 3.6, u), y: lerp(1.4, 0.3, u) },
          vel: { x: 0.32, y: -0.22 },
          heading: Math.atan2(-0.22, 0.32),
        };
      }
      return { present: false, motion: false, pos: null, vel: null, heading: null };
    }
    // walk_across_triangle + board3_lost (same path; board3_lost affects links)
    const { pos, vel, heading } = pathAt(WALK_PATH, this.simTime);
    const speed = Math.hypot(vel.x, vel.y);
    return { present: true, motion: speed > 0.05, pos, vel, heading };
  }

  private synthLink(
    linkId: string,
    a: Vec2,
    b: Vec2,
    person: Vec2 | null,
    lost: boolean
  ): LinkMetrics {
    if (lost) {
      return {
        link_id: linkId,
        rssi_dbm: null,
        motion_score: null,
        motion_threshold: 0.8,
        presence_score: null,
        presence_threshold: 0.6,
        csi_rate_hz: null,
        quality: "unavailable",
        amplitude_normalized: null,
      };
    }

    const width = 0.55;
    let disturbance = 0;
    if (person) {
      const d = distToSegment(person, a, b);
      disturbance = Math.exp(-(d * d) / (2 * width * width));
    }

    const noise = (this.rand() - 0.5) * 1.4;
    const rssi = -48 - 14 * disturbance + noise;
    const motion = person
      ? disturbance * (2.8 + this.rand()) + Math.abs(this.rand() - 0.5) * 0.3
      : 0.15 + this.rand() * 0.2;
    const presence = person
      ? 0.9 + disturbance * 2.2 + this.rand() * 0.3
      : 0.2 + this.rand() * 0.15;

    const amp = SUBCARRIER_INDICES.map((_, k) => {
      const pattern = Math.sin(k * 0.35 + this.simTime * 0.4) * 0.15;
      return clamp(1 + disturbance * (0.35 + pattern) + (this.rand() - 0.5) * 0.08, 0.2, 2.2);
    });
    const mean = amp.reduce((s, v) => s + v, 0) / amp.length;
    const normalized = amp.map((v) => v / mean);
    this.lastAmp[linkId] = normalized;

    return {
      link_id: linkId,
      rssi_dbm: Math.round(rssi * 10) / 10,
      motion_score: Math.round(motion * 100) / 100,
      motion_threshold: 0.8,
      presence_score: Math.round(presence * 100) / 100,
      presence_threshold: 0.6,
      csi_rate_hz: Math.round((68 + this.rand() * 8) * 10) / 10,
      quality: "good",
      amplitude_normalized: normalized,
    };
  }

  getScene(): SceneSnapshot {
    this.sequence += 1;
    const now = new Date().toISOString();
    const person = this.personState();
    const board3Lost = this.controls.scenario === "board3_lost";

    const link12 = this.synthLink(
      "b1-b2",
      B1,
      B2,
      person.pos,
      false
    );
    const link13 = this.synthLink(
      "b1-b3",
      B1,
      B3,
      person.pos,
      board3Lost
    );

    // Push history
    for (const link of [link12, link13]) {
      const arr = this.history[link.link_id];
      arr.push({
        t: now,
        rssi_dbm: link.rssi_dbm,
        motion_score: link.motion_score,
        presence_score: link.presence_score,
      });
      if (arr.length > 600) arr.shift();
    }

    let occState: OccupancyState = "empty_estimate";
    let presenceDetected: boolean | null = false;
    if (!person.present) {
      occState = "empty_estimate";
      presenceDetected = false;
    } else if (person.motion) {
      occState = "motion";
      presenceDetected = true;
    } else {
      occState = "presence";
      presenceDetected = true;
    }

    const tracks: Track[] = [];
    if (person.pos) {
      tracks.push({
        track_id: "sim-person-1",
        status: "tracked",
        observed_at: now,
        provenance: "simulation",
        position: {
          frame: "room_local_z_up",
          kind: "floor_xy",
          x_m: person.pos.x,
          y_m: person.pos.y,
          z_m: null,
        },
        velocity_mps: person.vel
          ? { x: person.vel.x, y: person.vel.y, z: null }
          : { x: null, y: null, z: null },
        heading_rad: person.heading,
        confidence: { value: 0.72, kind: "uncalibrated_score" },
        uncertainty: {
          kind: "illustrative_covariance",
          axes: ["x", "y"],
          covariance_m2: [
            [0.16, 0],
            [0, 0.09],
          ],
        },
        inference: {
          method: "synthetic_fixture_v1",
          model_version: null,
          calibration_ids: ["cal-demo-b2", "cal-demo-b3"],
        },
        pose: null,
      });
    }

    return {
      schema_version: "1.0",
      room_id: this.roomId,
      session_id: this.sessionId,
      layout_revision: DEFAULT_LAYOUT.revision,
      stream_id: this.streamId,
      sequence: this.sequence,
      mode: "simulation",
      observed_at: now,
      emitted_at: now,
      quality: {
        status: board3Lost ? "degraded" : "good",
        coverage: board3Lost ? "partial" : "complete",
        effective_age_ms: 50,
        reasons: board3Lost ? ["Board 3 telemetry lost (simulated)"] : [],
      },
      occupancy: {
        state: occState,
        presence_detected: presenceDetected,
        person_count: person.present ? 1 : 0,
        provenance: "simulation",
      },
      nodes: [
        { board_id: "b1", connection: "online", calibration_status: "not_applicable" },
        { board_id: "b2", connection: "online", calibration_status: "ready" },
        {
          board_id: "b3",
          connection: board3Lost ? "offline" : "online",
          calibration_status: board3Lost ? "required" : "ready",
        },
      ],
      links: [link12, link13],
      tracks,
      heatmap: null,
    };
  }

  getSignalHistory(linkId: string): SignalHistory {
    const points = this.history[linkId] || [];
    return {
      schema_version: "1.0",
      link_id: linkId,
      from: points[0]?.t || new Date().toISOString(),
      to: points[points.length - 1]?.t || new Date().toISOString(),
      points: [...points],
    };
  }

  getCsiWindow(): CsiWindow {
    const now = Date.now();
    const timestamps = [0, 1].map((i) => new Date(now - (1 - i) * 500).toISOString());
    const board3Lost = this.controls.scenario === "board3_lost";
    const values = timestamps.map(() =>
      ["b1-b2", "b1-b3"].map((id) => {
        if (id === "b1-b3" && board3Lost) return Array(3).fill(null);
        const full = this.lastAmp[id] || Array(51).fill(1);
        return [full[0], full[1], full[2]];
      })
    );
    return {
      schema_version: "1.0",
      mode: "simulation",
      axes: ["time", "link", "subcarrier"],
      shape: [2, 2, 3],
      representation: "normalized_amplitude_v1",
      units: "ratio_to_frame_mean",
      timestamps,
      link_ids: ["b1-b2", "b1-b3"],
      subcarrier_index_kind: "lltf_buffer_bin",
      subcarrier_indices: [2, 3, 4],
      values,
      valid: [
        [true, !board3Lost],
        [true, !board3Lost],
      ],
      alignment: { method: "time_bucket", bucket_ms: 500, fill: "null" },
      calibration_ids: ["cal-demo-b2", "cal-demo-b3"],
      layout_revision: 1,
    };
  }
}

/** Singleton used by API routes + optional client-side fallback. */
const g = globalThis as unknown as { __sensingSim?: SensingSimulator };
export function getSimulator() {
  if (!g.__sensingSim) g.__sensingSim = new SensingSimulator();
  return g.__sensingSim;
}
