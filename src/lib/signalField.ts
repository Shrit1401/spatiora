import type { LinkMetrics, RoomLayout } from "./types";

export type Vec2 = { x: number; y: number };

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

/** Distance from point to segment (floor plane). */
export function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const len2 = abx * abx + aby * aby;
  if (len2 < 1e-9) return Math.hypot(p.x - a.x, p.y - a.y);
  const u = clamp(((p.x - a.x) * abx + (p.y - a.y) * aby) / len2, 0, 1);
  return Math.hypot(p.x - (a.x + u * abx), p.y - (a.y + u * aby));
}

/**
 * Relative activity score at floor sample `p` from measured links only.
 * Uses presence/motion scores as link weights — not a propagation model.
 */
export function fieldScoreAt(
  p: Vec2,
  layout: RoomLayout,
  links: LinkMetrics[],
  widthM = 0.55
): number {
  let score = 0;
  let weight = 0;
  for (const link of layout.sensing_links) {
    if (!link.enabled) continue;
    const m = links.find((l) => l.link_id === link.link_id);
    if (!m || m.rssi_dbm == null) continue;

    const tx = layout.boards.find((b) => b.board_id === link.tx_board_id);
    const rx = layout.boards.find((b) => b.board_id === link.rx_board_id);
    if (!tx || !rx) continue;

    const a = { x: tx.position_m[0], y: tx.position_m[1] };
    const b = { x: rx.position_m[0], y: rx.position_m[1] };
    const d = distToSegment(p, a, b);
    const proximity = Math.exp(-(d * d) / (2 * widthM * widthM));

    const motion =
      m.motion_score != null && m.motion_threshold != null
        ? m.motion_score / Math.max(m.motion_threshold, 0.01)
        : 0;
    const presence =
      m.presence_score != null && m.presence_threshold != null
        ? m.presence_score / Math.max(m.presence_threshold, 0.01)
        : 0;
    const activity = Math.min(2, 0.35 * motion + 0.65 * presence);

    score += proximity * activity;
    weight += proximity;
  }
  if (weight < 1e-4) return 0;
  // Normalize by local proximity mass (not link count) so hot corridors stay bright
  return score / Math.max(weight, 0.35);
}

export type FieldGrid = {
  nx: number;
  ny: number;
  originX: number;
  originY: number;
  cell: number;
  values: Float32Array;
};

/** Build a coarse floor field for the monitored bounds. */
export function computeFieldGrid(
  layout: RoomLayout,
  links: LinkMetrics[],
  nx = 28,
  ny = 22
): FieldGrid {
  const { min_x, max_x, min_y, max_y } = layout.floor_bounds;
  const cellX = (max_x - min_x) / nx;
  const cellY = (max_y - min_y) / ny;
  const cell = Math.min(cellX, cellY);
  const values = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const x = min_x + (i + 0.5) * cellX;
      const y = min_y + (j + 0.5) * cellY;
      values[j * nx + i] = fieldScoreAt({ x, y }, layout, links);
    }
  }
  return { nx, ny, originX: min_x, originY: min_y, cell, values };
}

/** Map relative activity → warm dark theme colors (near-black → orange → green). */
export function scoreToColor(s: number, out: { r: number; g: number; b: number }) {
  // Quiet floor stays almost black; color only kicks in when something is happening
  const t = clamp(s, 0, 1.5) / 1.5;
  if (t < 0.22) {
    const u = t / 0.22;
    out.r = 0.07 + u * 0.08;
    out.g = 0.065 + u * 0.04;
    out.b = 0.055 + u * 0.02;
  } else if (t < 0.55) {
    const u = (t - 0.22) / 0.33;
    out.r = 0.15 + u * 0.55;
    out.g = 0.1 + u * 0.18;
    out.b = 0.075 + u * 0.04;
  } else if (t < 0.82) {
    const u = (t - 0.55) / 0.27;
    out.r = 0.7 + u * 0.2;
    out.g = 0.28 + u * 0.18;
    out.b = 0.12 + u * 0.02;
  } else {
    const u = (t - 0.82) / 0.18;
    out.r = 0.9 - u * 0.55;
    out.g = 0.46 + u * 0.35;
    out.b = 0.14 + u * 0.22;
  }
}
