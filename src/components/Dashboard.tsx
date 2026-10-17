"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchCapabilities,
  fetchCsiWindow,
  fetchHealth,
  fetchLayout,
  fetchScene,
  patchSimulation,
} from "@/lib/api";
import type {
  Capabilities,
  CsiWindow,
  RoomLayout,
  ScenarioId,
  SceneSnapshot,
  SignalHistoryPoint,
  SimControls,
} from "@/lib/types";
import RoomScene from "./RoomScene";
import styles from "./console.module.css";

const SCENARIOS: { id: ScenarioId; label: string }[] = [
  { id: "walk_across_triangle", label: "Walk across triangle" },
  { id: "stand_still", label: "Stand still" },
  { id: "enter_pause_leave", label: "Enter / pause / leave" },
  { id: "empty", label: "Empty room" },
  { id: "board3_lost", label: "Board 3 lost" },
];

function Spark({
  points,
  color,
  keyName,
}: {
  points: SignalHistoryPoint[];
  color: string;
  keyName: "rssi_dbm" | "motion_score" | "presence_score";
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const w = c.width;
    const h = c.height;
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = "rgba(44,41,36,0.9)";
    ctx.beginPath();
    for (let y = 14; y < h; y += 14) {
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
    }
    ctx.stroke();

    const vals = points.map((p) => p[keyName]).filter((v): v is number => v != null);
    if (vals.length < 2) return;
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const span = max - min || 1;
    const top = 5;
    const bottom = h - 5;

    const pts: { x: number; y: number }[] = [];
    points.forEach((p, i) => {
      const v = p[keyName];
      if (v == null) return;
      pts.push({
        x: (i / Math.max(points.length - 1, 1)) * w,
        y: bottom - ((v - min) / span) * (bottom - top),
      });
    });
    if (pts.length < 2) return;

    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.lineTo(pts[pts.length - 1].x, bottom);
    ctx.lineTo(pts[0].x, bottom);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, top, 0, bottom);
    g.addColorStop(0, color + "44");
    g.addColorStop(1, color + "00");
    ctx.fillStyle = g;
    ctx.fill();

    ctx.strokeStyle = color;
    ctx.lineWidth = 1.6;
    ctx.lineJoin = "round";
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.stroke();
  }, [points, color, keyName]);

  return <canvas ref={ref} width={272} height={58} className={styles.chart} />;
}

function AmpBars({ csi }: { csi: CsiWindow | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c || !csi) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const w = c.width;
    const h = c.height;
    ctx.clearRect(0, 0, w, h);
    const row = csi.values[csi.values.length - 1]?.[0];
    if (!row) return;
    const n = row.length;
    const bw = w / n;
    row.forEach((v, i) => {
      if (v == null) {
        ctx.fillStyle = "#2c2924";
        ctx.fillRect(i * bw + 2, h / 2 - 2, bw - 4, 4);
        return;
      }
      const barH = Math.min(h - 8, v * 24);
      ctx.fillStyle = "#e8722c";
      ctx.fillRect(i * bw + 2, h - barH - 4, bw - 4, barH);
    });
  }, [csi]);
  return <canvas ref={ref} width={272} height={58} className={styles.chart} />;
}

export default function Dashboard() {
  const [layout, setLayout] = useState<RoomLayout | null>(null);
  const [scene, setScene] = useState<SceneSnapshot | null>(null);
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [hist, setHist] = useState<Record<string, SignalHistoryPoint[]>>({});
  const [csi, setCsi] = useState<CsiWindow | null>(null);
  const [controls, setControls] = useState<SimControls>({
    playing: true,
    speed: 1,
    scenario: "walk_across_triangle",
    seed: 42,
  });
  const [apiOk, setApiOk] = useState(true);
  const [linkFocus, setLinkFocus] = useState("b1-b2");

  useEffect(() => {
    fetchLayout().then(setLayout);
    fetchCapabilities().then(setCaps);
    fetchHealth()
      .then((h) => setApiOk(h.ok))
      .catch(() => setApiOk(false));
  }, []);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      if (!alive) return;
      try {
        const snap = await fetchScene();
        if (!alive) return;
        setScene(snap);
        setApiOk(true);
        const t = snap.emitted_at;
        setHist((prev) => {
          const next = { ...prev };
          for (const l of snap.links) {
            const arr = [...(next[l.link_id] || [])];
            arr.push({
              t,
              rssi_dbm: l.rssi_dbm,
              motion_score: l.motion_score,
              presence_score: l.presence_score,
            });
            if (arr.length > 120) arr.splice(0, arr.length - 120);
            next[l.link_id] = arr;
          }
          return next;
        });
      } catch {
        setApiOk(false);
      }
      if (Math.random() < 0.3) {
        const w = await fetchCsiWindow();
        if (alive) setCsi(w);
      }
    };
    poll();
    const id = setInterval(poll, 450);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const control = useCallback(async (body: Parameters<typeof patchSimulation>[1]) => {
    const res = await patchSimulation("sim-1", body);
    setControls(res.controls);
  }, []);

  const occ = useMemo(() => {
    const s = scene?.occupancy.state;
    if (s === "motion")
      return { title: "Someone is moving", cls: styles.presenceYes };
    if (s === "presence")
      return { title: "Someone is there", cls: styles.presenceYes };
    if (s === "empty_estimate")
      return { title: "No presence", cls: styles.presenceNo };
    return { title: "Unknown", cls: styles.presenceUnknown };
  }, [scene]);

  const focusLink = scene?.links.find((l) => l.link_id === linkFocus);

  if (!layout) {
    return (
      <div className={styles.loading}>
        <div className={styles.brandMark} />
        <span>Loading room layout…</span>
      </div>
    );
  }

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <div className={styles.brandRow}>
          <div className={styles.brandMark} aria-hidden />
          <div className={styles.brandText}>
            <strong>Spatiora</strong>
            <small>Wi-Fi sensing console</small>
          </div>
        </div>

        <div className={styles.sideBody}>
          <div>
            <div className={styles.sectionLabel}>Boards</div>
            <div className={styles.nodeList}>
              {(scene?.nodes || layout.boards.map((b) => ({
                board_id: b.board_id,
                connection: "unknown" as const,
                calibration_status: "not_started" as const,
              }))).map((n) => (
                <div key={n.board_id} className={styles.nodeRow}>
                  <span
                    className={`${styles.dot} ${
                      n.connection === "online" ? styles.dotOn : styles.dotOff
                    }`}
                  />
                  <span className={styles.mono}>{n.board_id}</span>
                  <span className={styles.nodeMeta}>{n.calibration_status}</span>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className={styles.sectionLabel}>Sensing links</div>
            <div className={styles.linkList}>
              {(scene?.links || []).map((l) => (
                <button
                  key={l.link_id}
                  type="button"
                  className={`${styles.linkRow} ${
                    linkFocus === l.link_id ? styles.linkActive : ""
                  }`}
                  onClick={() => setLinkFocus(l.link_id)}
                >
                  <span className={styles.mono}>{l.link_id}</span>
                  <span className={`${styles.nodeMeta} ${styles.mono}`}>
                    {l.rssi_dbm == null ? "n/a" : `${l.rssi_dbm} dBm`}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className={styles.sectionLabel}>Scenario</div>
            <div className={styles.scenarioList}>
              {SCENARIOS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={`${styles.chip} ${
                    controls.scenario === s.id ? styles.chipOn : ""
                  }`}
                  onClick={() => control({ scenario: s.id, action: "resume" })}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className={styles.sideFoot}>
          Coverage {scene?.quality.coverage || "—"} · seq{" "}
          <span className={styles.mono}>{scene?.sequence ?? "—"}</span>
        </div>
      </aside>

      <div className={styles.main}>
        <header className={styles.topbar}>
          <div className={styles.topLeft}>
            <h1>Room twin</h1>
            <span className={styles.badge}>
              <span className={styles.badgeDot} />
              simulation
            </span>
            <span className={apiOk ? styles.statusOk : styles.statusBad}>
              {apiOk ? "API ok" : "API fallback"}
            </span>
          </div>
          <div className={styles.topActions}>
            <button
              type="button"
              className={styles.btnPrimary}
              onClick={() =>
                control({ action: controls.playing ? "pause" : "resume" })
              }
            >
              {controls.playing ? "Pause" : "Play"}
            </button>
            <button
              type="button"
              className={styles.btn}
              onClick={() => control({ action: "reset" })}
            >
              Reset
            </button>
            <button
              type="button"
              className={styles.btn}
              onClick={() =>
                control({
                  speed_multiplier: controls.speed >= 2 ? 1 : controls.speed + 0.5,
                })
              }
            >
              {controls.speed}×
            </button>
            <select
              className={styles.select}
              value={controls.scenario}
              onChange={(e) =>
                control({
                  scenario: e.target.value as ScenarioId,
                  action: "resume",
                })
              }
            >
              {SCENARIOS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
        </header>

        <div className={styles.workspace}>
          <div className={styles.viewport}>
            <RoomScene layout={layout} scene={scene} />
            <div className={styles.presenceCard}>
              <div className={styles.presenceEyebrow}>Presence</div>
              <div className={`${styles.presenceTitle} ${occ.cls}`}>{occ.title}</div>
              <div className={styles.presenceSub}>
                {(scene?.quality.coverage || "—").replaceAll("_", " ")} coverage ·{" "}
                {caps?.mode || "simulation"}
              </div>
            </div>
            <div className={styles.fieldLegend} aria-hidden>
              <div className={styles.fieldLegendTitle}>Link activity field</div>
              <div className={styles.fieldLegendBar} />
              <div className={styles.fieldLegendScale}>
                <span>quiet</span>
                <span>active</span>
              </div>
              <div className={styles.fieldLegendNote}>
                From measured b1→b2 / b1→b3 only · no B2–B3 RF edge
              </div>
            </div>
            <div className={styles.dimBadge} aria-hidden>
              equilateral · 4.00 m sides · boards @ 1.20 m
            </div>
            <div className={styles.hint}>Drag to orbit · scroll to zoom</div>
          </div>

          <aside className={styles.rail}>
            <div className={styles.card}>
              <h2>Occupancy</h2>
              <div className={`${styles.metric} ${styles.metricHot}`}>
                <span>State</span>
                <b>{(scene?.occupancy.state || "—").replaceAll("_", " ")}</b>
              </div>
              <div className={styles.metric}>
                <span>Presence</span>
                <b>
                  {scene?.occupancy.presence_detected == null
                    ? "null"
                    : String(scene.occupancy.presence_detected)}
                </b>
              </div>
              <div className={styles.metric}>
                <span>Person count</span>
                <b>
                  {scene?.occupancy.person_count == null
                    ? "null"
                    : String(scene.occupancy.person_count)}
                </b>
              </div>
              <div className={styles.metric}>
                <span>Quality</span>
                <b>{scene?.quality.status || "—"}</b>
              </div>
            </div>

            <div className={styles.card}>
              <h2>Link {linkFocus}</h2>
              <div className={styles.metric}>
                <span>RSSI</span>
                <b className={styles.mono}>
                  {focusLink?.rssi_dbm == null
                    ? "null"
                    : `${focusLink.rssi_dbm} dBm`}
                </b>
              </div>
              <div className={styles.metric}>
                <span>Motion</span>
                <b className={styles.mono}>
                  {focusLink?.motion_score == null
                    ? "null"
                    : `${focusLink.motion_score} / ${focusLink.motion_threshold}`}
                </b>
              </div>
              <div className={styles.metric}>
                <span>Presence score</span>
                <b className={styles.mono}>
                  {focusLink?.presence_score == null
                    ? "null"
                    : `${focusLink.presence_score} / ${focusLink.presence_threshold}`}
                </b>
              </div>
              <div className={styles.metric}>
                <span>CSI rate</span>
                <b className={styles.mono}>
                  {focusLink?.csi_rate_hz == null
                    ? "null"
                    : `${focusLink.csi_rate_hz} Hz`}
                </b>
              </div>
            </div>

            <div className={styles.card}>
              <h2>Diagnostics</h2>
              <div className={styles.chartBlock}>
                <div className={styles.chartLabel}>RSSI (dBm)</div>
                <Spark
                  points={hist[linkFocus] || []}
                  color="#c9b8a4"
                  keyName="rssi_dbm"
                />
              </div>
              <div className={styles.chartBlock}>
                <div className={styles.chartLabel}>Motion score</div>
                <Spark
                  points={hist[linkFocus] || []}
                  color="#3ecf8e"
                  keyName="motion_score"
                />
              </div>
              <div className={styles.chartBlock}>
                <div className={styles.chartLabel}>Presence score</div>
                <Spark
                  points={hist[linkFocus] || []}
                  color="#e8722c"
                  keyName="presence_score"
                />
              </div>
              <div className={styles.chartBlock}>
                <div className={styles.chartLabel}>CSI amplitude · bins 2–4</div>
                <AmpBars csi={csi} />
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
