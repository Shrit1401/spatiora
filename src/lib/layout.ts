import type { RoomLayout } from "./types";

/** Default demonstration layout from the sensing contract (meters, z-up). */
export const DEFAULT_LAYOUT: RoomLayout = {
  schema_version: "1.0",
  room_id: "room-1",
  revision: 1,
  coordinate_frame: "room_local_z_up",
  units: "meters",
  floor_bounds: { min_x: -0.5, max_x: 4.5, min_y: -0.5, max_y: 4.0 },
  boards: [
    { board_id: "b1", role: "transmitter_hub", position_m: [0.0, 0.0, 1.2] },
    { board_id: "b2", role: "receiver", position_m: [4.0, 0.0, 1.2] },
    { board_id: "b3", role: "receiver", position_m: [2.0, 3.46, 1.2] },
  ],
  monitored_polygon_xy: [
    [0.0, 0.0],
    [4.0, 0.0],
    [2.0, 3.46],
  ],
  sensing_links: [
    { link_id: "b1-b2", tx_board_id: "b1", rx_board_id: "b2", enabled: true },
    { link_id: "b1-b3", tx_board_id: "b1", rx_board_id: "b3", enabled: true },
  ],
  display: {
    avatar_height_m: 1.7,
    avatar_height_source: "illustrative_default",
  },
};

/** Subcarrier buffer-bin indices used by prototype receivers (K=51). */
export const SUBCARRIER_INDICES: number[] = [
  ...Array.from({ length: 25 }, (_, i) => i + 2),
  ...Array.from({ length: 26 }, (_, i) => i + 38),
];

export const ROOM_ID = process.env.NEXT_PUBLIC_ROOM_ID || "room-1";
export const SESSION_ID = process.env.NEXT_PUBLIC_SESSION_ID || "sim-1";
