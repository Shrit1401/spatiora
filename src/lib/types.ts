/** Canonical sensing contract types (schema 1.0) — frontend + mock API. */

export type SchemaVersion = "1.0";
export type SessionMode = "live" | "simulation" | "replay";
export type FeatureStatus = "unavailable" | "experimental" | "validated" | "simulated";
export type OccupancyState = "unknown" | "empty_estimate" | "presence" | "motion";
export type ConnectionState = "online" | "offline" | "unknown";
export type CalibrationStatus =
  | "not_applicable"
  | "not_started"
  | "running"
  | "ready"
  | "required"
  | "failed";
export type QualityStatus = "good" | "degraded" | "stale" | "unavailable";
export type Coverage = "complete" | "partial" | "none";
export type TrackStatus = "tentative" | "tracked" | "lost";
export type LinkQuality = "good" | "degraded" | "stale" | "unavailable";

export type StreamEventType =
  | "scene.snapshot"
  | "calibration.updated"
  | "capabilities.updated"
  | "heartbeat"
  | "error";

export interface RoomLayout {
  schema_version: SchemaVersion;
  room_id: string;
  revision: number;
  coordinate_frame: "room_local_z_up";
  units: "meters";
  floor_bounds: { min_x: number; max_x: number; min_y: number; max_y: number };
  boards: Array<{
    board_id: string;
    role: "transmitter_hub" | "receiver";
    position_m: [number, number, number];
  }>;
  monitored_polygon_xy: [number, number][];
  sensing_links: Array<{
    link_id: string;
    tx_board_id: string;
    rx_board_id: string;
    enabled: boolean;
  }>;
  display: { avatar_height_m: number; avatar_height_source: string };
}

export interface Capabilities {
  schema_version: SchemaVersion;
  room_id: string;
  session_id: string;
  mode: SessionMode;
  features: Record<string, FeatureStatus>;
  link_ids: string[];
  max_tracks: number | null;
  observed_telemetry_rate_hz: number | null;
  observed_scene_rate_hz: number | null;
  quality_policy: { csi_stale_after_ms: number; node_stale_after_ms: number };
  limitations: string[];
}

export interface LinkMetrics {
  link_id: string;
  rssi_dbm: number | null;
  motion_score: number | null;
  motion_threshold: number | null;
  presence_score: number | null;
  presence_threshold: number | null;
  csi_rate_hz: number | null;
  quality: LinkQuality;
  amplitude_normalized?: number[] | null;
}

export interface Track {
  track_id: string;
  status: TrackStatus;
  observed_at: string;
  provenance: string;
  position: {
    frame: "room_local_z_up";
    kind: "floor_xy";
    x_m: number;
    y_m: number;
    z_m: number | null;
  };
  velocity_mps: { x: number | null; y: number | null; z: number | null };
  heading_rad: number | null;
  confidence: { value: number | null; kind: string } | null;
  uncertainty: {
    kind: string;
    axes: string[];
    covariance_m2: number[][];
  } | null;
  inference: {
    method: string;
    model_version: string | null;
    calibration_ids: string[];
  } | null;
  pose: null;
}

export interface SceneSnapshot {
  schema_version: SchemaVersion;
  room_id: string;
  session_id: string;
  layout_revision: number;
  stream_id: string;
  sequence: number;
  mode: SessionMode;
  observed_at: string | null;
  emitted_at: string;
  quality: {
    status: QualityStatus;
    coverage: Coverage;
    effective_age_ms: number | null;
    reasons: string[];
  };
  occupancy: {
    state: OccupancyState;
    presence_detected: boolean | null;
    person_count: number | null;
    provenance: string;
  };
  nodes: Array<{
    board_id: string;
    connection: ConnectionState;
    calibration_status: CalibrationStatus;
  }>;
  links: LinkMetrics[];
  tracks: Track[];
  heatmap: null;
}

export interface StreamEvent<T = unknown> {
  schema_version: SchemaVersion;
  type: StreamEventType;
  room_id: string;
  session_id: string;
  stream_id: string;
  sequence: number;
  emitted_at: string;
  payload: T;
}

export interface SignalHistoryPoint {
  t: string;
  rssi_dbm: number | null;
  motion_score: number | null;
  presence_score: number | null;
}

export interface SignalHistory {
  schema_version: SchemaVersion;
  link_id: string;
  from: string;
  to: string;
  points: SignalHistoryPoint[];
}

export interface CsiWindow {
  schema_version: SchemaVersion;
  mode: SessionMode;
  axes: ["time", "link", "subcarrier"];
  shape: [number, number, number];
  representation: string;
  units: string;
  timestamps: string[];
  link_ids: string[];
  subcarrier_index_kind: string;
  subcarrier_indices: number[];
  values: (number | null)[][][];
  valid: boolean[][];
  alignment: { method: string; bucket_ms: number; fill: string };
  calibration_ids: string[];
  layout_revision: number;
}

export interface HealthResponse {
  ok: boolean;
  service: string;
  build: string;
  mode: SessionMode;
  time: string;
}

export type ScenarioId =
  | "empty"
  | "walk_across_triangle"
  | "stand_still"
  | "enter_pause_leave"
  | "board3_lost";

export interface SimControls {
  playing: boolean;
  speed: number;
  scenario: ScenarioId;
  seed: number;
}
