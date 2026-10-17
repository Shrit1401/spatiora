"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { LinkMetrics, RoomLayout, SceneSnapshot } from "@/lib/types";

/** room_local_z_up → Three.js Y-up: (x, y, z) → (x, z, -y) */
function toThree(x: number, y: number, z: number): THREE.Vector3 {
  return new THREE.Vector3(x, z, -y);
}

type Props = {
  layout: RoomLayout;
  scene: SceneSnapshot | null;
};

type Shell = {
  mesh: THREE.Mesh;
  t: number;
  life: number;
  maxR: number;
  active: boolean;
};

type BoardViz = {
  boardId: string;
  led: THREE.Mesh;
  chartSprite: THREE.Sprite;
  chartCtx: CanvasRenderingContext2D;
  chartTex: THREE.CanvasTexture;
  history: number[];
  worldPos: THREE.Vector3;
};

function makeChartCanvas() {
  const cv = document.createElement("canvas");
  cv.width = 160;
  cv.height = 72;
  const ctx = cv.getContext("2d")!;
  return { cv, ctx };
}

function drawBoardChart(
  ctx: CanvasRenderingContext2D,
  tex: THREE.CanvasTexture,
  boardId: string,
  history: number[],
  live: LinkMetrics | null,
  online: boolean
) {
  const w = 160;
  const h = 72;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "rgba(15,14,12,0.88)";
  ctx.strokeStyle = "rgba(61,57,50,0.9)";
  ctx.lineWidth = 1;
  roundRect(ctx, 0.5, 0.5, w - 1, h - 1, 6);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = online ? "#c9c2b6" : "#5e584f";
  ctx.font = "bold 11px ui-monospace, Menlo, monospace";
  ctx.fillText(boardId.toUpperCase(), 8, 14);

  if (live?.rssi_dbm != null) {
    ctx.fillStyle = "#8f887c";
    ctx.font = "10px ui-monospace, Menlo, monospace";
    ctx.textAlign = "right";
    ctx.fillText(`${live.rssi_dbm} dBm`, w - 8, 14);
    ctx.textAlign = "left";
  } else {
    ctx.fillStyle = "#5e584f";
    ctx.font = "10px ui-monospace, Menlo, monospace";
    ctx.textAlign = "right";
    ctx.fillText("no link", w - 8, 14);
    ctx.textAlign = "left";
  }

  // Sparkline from real RSSI history only — gaps stay gaps
  const vals = history.filter((v) => Number.isFinite(v));
  if (vals.length >= 2) {
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const span = max - min || 1;
    const top = 22;
    const bottom = h - 8;
    ctx.strokeStyle = "#e8722c";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    history.forEach((v, i) => {
      if (!Number.isFinite(v)) return;
      const x = 8 + (i / Math.max(history.length - 1, 1)) * (w - 16);
      const y = bottom - ((v - min) / span) * (bottom - top);
      i === 0 || !Number.isFinite(history[i - 1])
        ? ctx.moveTo(x, y)
        : ctx.lineTo(x, y);
    });
    ctx.stroke();
  } else {
    ctx.fillStyle = "#5e584f";
    ctx.font = "10px system-ui,sans-serif";
    ctx.fillText("waiting for samples…", 8, 44);
  }

  // Motion bar from real score vs threshold
  if (live?.motion_score != null && live.motion_threshold != null) {
    const ratio = Math.min(1.5, live.motion_score / Math.max(live.motion_threshold, 0.01));
    const bw = Math.min(w - 16, ratio * (w - 16));
    ctx.fillStyle = "rgba(44,41,36,0.9)";
    ctx.fillRect(8, h - 6, w - 16, 3);
    ctx.fillStyle = ratio > 1 ? "#3ecf8e" : "#e8722c";
    ctx.fillRect(8, h - 6, bw, 3);
  }

  tex.needsUpdate = true;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function linkForBoard(snap: SceneSnapshot, boardId: string): LinkMetrics | null {
  // Measured topology: b1 transmits, b2/b3 receive. Hub shows strongest live link.
  if (boardId === "b1") {
    const links = snap.links.filter((l) => l.rssi_dbm != null);
    if (!links.length) return null;
    return links.reduce((a, b) =>
      (a.motion_score ?? 0) >= (b.motion_score ?? 0) ? a : b
    );
  }
  return snap.links.find((l) => l.link_id === `b1-${boardId}`) || null;
}

export default function RoomScene({ layout, scene }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<SceneSnapshot | null>(null);
  const avatarRef = useRef<THREE.Group | null>(null);
  const trailRef = useRef<THREE.Line | null>(null);
  const trailPts = useRef<THREE.Vector3[]>([]);
  const linkMats = useRef<Record<string, THREE.LineBasicMaterial>>({});
  const boardsRef = useRef<BoardViz[]>([]);
  const shellsRef = useRef<Shell[]>([]);
  const personRingsRef = useRef<THREE.Mesh[]>([]);
  const shellGeo = useRef<THREE.SphereGeometry | null>(null);
  const spawnAcc = useRef(0);
  const chartAcc = useRef(0);

  useEffect(() => {
    sceneRef.current = scene;
  }, [scene]);

  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance",
    });
    renderer.setClearColor(0x0f0e0c, 1);
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
    el.appendChild(renderer.domElement);

    const threeScene = new THREE.Scene();
    threeScene.fog = new THREE.Fog(0x0f0e0c, 12, 28);

    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 80);
    camera.position.set(5.5, 6.2, 7.5);
    camera.lookAt(2, 0.8, -1.5);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(2, 0.6, -1.5);
    controls.enableDamping = true;
    controls.minDistance = 4;
    controls.maxDistance = 18;
    controls.maxPolarAngle = Math.PI * 0.45;
    controls.update();

    threeScene.add(new THREE.AmbientLight(0xb8c0cc, 0.55));
    const key = new THREE.DirectionalLight(0xffffff, 0.75);
    key.position.set(4, 10, 3);
    threeScene.add(key);

    const fb = layout.floor_bounds;
    const fw = fb.max_x - fb.min_x;
    const fd = fb.max_y - fb.min_y;
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(fw, fd),
      new THREE.MeshStandardMaterial({ color: 0x171512, roughness: 0.95 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.copy(
      toThree((fb.min_x + fb.max_x) / 2, (fb.min_y + fb.max_y) / 2, 0)
    );
    threeScene.add(floor);

    const grid = new THREE.GridHelper(Math.max(fw, fd), 10, 0x2a2824, 0x1f1c18);
    grid.position.copy(floor.position);
    threeScene.add(grid);

    // Triangle = geometry only (not a measured B2–B3 radio link)
    const poly = layout.monitored_polygon_xy;
    const triPts = [...poly, poly[0]].map(([x, y]) => toThree(x, y, 0.02));
    threeScene.add(
      new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(triPts),
        new THREE.LineBasicMaterial({
          color: 0x5e584f,
          transparent: true,
          opacity: 0.55,
        })
      )
    );

    shellGeo.current = new THREE.SphereGeometry(1, 18, 12);
    boardsRef.current = [];

    layout.boards.forEach((b) => {
      const [x, y, z] = b.position_m;
      const g = new THREE.Group();
      const worldPos = toThree(x, y, z);
      g.position.copy(worldPos);

      const board = new THREE.Mesh(
        new THREE.BoxGeometry(0.12, 0.28, 0.06),
        new THREE.MeshStandardMaterial({
          color: 0x1a1916,
          emissive: 0xe8722c,
          emissiveIntensity: 0.12,
          metalness: 0.35,
          roughness: 0.45,
        })
      );
      g.add(board);

      const led = new THREE.Mesh(
        new THREE.SphereGeometry(0.03, 10, 8),
        new THREE.MeshBasicMaterial({ color: 0x3ecf8e })
      );
      led.position.y = 0.18;
      g.add(led);

      const { cv, ctx } = makeChartCanvas();
      const chartTex = new THREE.CanvasTexture(cv);
      chartTex.needsUpdate = true;
      const chartSprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: chartTex,
          transparent: true,
          depthTest: false,
        })
      );
      chartSprite.scale.set(0.95, 0.43, 1);
      chartSprite.position.set(0, 0.55, 0);
      g.add(chartSprite);

      const drop = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          toThree(x, y, 0),
          toThree(x, y, z),
        ]),
        new THREE.LineBasicMaterial({
          color: 0x3d3932,
          transparent: true,
          opacity: 0.45,
        })
      );
      threeScene.add(drop);
      threeScene.add(g);

      boardsRef.current.push({
        boardId: b.board_id,
        led,
        chartSprite,
        chartCtx: ctx,
        chartTex,
        history: [],
        worldPos: worldPos.clone(),
      });
    });

    // Only configured sensing links (b1-b2, b1-b3)
    layout.sensing_links
      .filter((l) => l.enabled)
      .forEach((link) => {
        const tx = layout.boards.find((b) => b.board_id === link.tx_board_id)!;
        const rx = layout.boards.find((b) => b.board_id === link.rx_board_id)!;
        const mat = new THREE.LineBasicMaterial({
          color: 0x6aa3d8,
          transparent: true,
          opacity: 0.4,
        });
        linkMats.current[link.link_id] = mat;
        threeScene.add(
          new THREE.Line(
            new THREE.BufferGeometry().setFromPoints([
              toThree(...tx.position_m),
              toThree(...rx.position_m),
            ]),
            mat
          )
        );
      });

    // Avatar — only shown when provider supplies a track position
    const avatar = new THREE.Group();
    const skin = new THREE.MeshStandardMaterial({
      color: 0x3ecf8e,
      emissive: 0x1a5c3d,
      emissiveIntensity: 0.25,
      transparent: true,
      opacity: 0.92,
    });
    const torso = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.14, 0.55, 12),
      skin
    );
    torso.position.y = 1.05;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 10), skin);
    head.position.y = 1.45;
    const legs = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.1, 0.7, 10),
      skin
    );
    legs.position.y = 0.4;
    const feet = new THREE.Mesh(
      new THREE.RingGeometry(0.22, 0.28, 36),
      new THREE.MeshBasicMaterial({
        color: 0x3ecf8e,
        transparent: true,
        opacity: 0.7,
        side: THREE.DoubleSide,
      })
    );
    feet.rotation.x = -Math.PI / 2;
    feet.position.y = 0.03;
    avatar.add(torso, head, legs, feet);
    avatar.visible = false;
    threeScene.add(avatar);
    avatarRef.current = avatar;

    // Floor ripples around person — presentation of measured motion, not RF path
    personRingsRef.current = [];
    for (let i = 0; i < 3; i++) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.15, 0.2, 48),
        new THREE.MeshBasicMaterial({
          color: 0x3ecf8e,
          transparent: true,
          opacity: 0,
          side: THREE.DoubleSide,
          depthWrite: false,
        })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.visible = false;
      threeScene.add(ring);
      personRingsRef.current.push(ring);
    }

    const trail = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({
        color: 0x3ecf8e,
        transparent: true,
        opacity: 0.4,
      })
    );
    threeScene.add(trail);
    trailRef.current = trail;

    function acquireShell(): Shell | null {
      let s = shellsRef.current.find((x) => !x.active);
      if (!s) {
        if (shellsRef.current.length >= 10) return null;
        const mesh = new THREE.Mesh(
          shellGeo.current!,
          new THREE.MeshBasicMaterial({
            color: 0xe8722c,
            wireframe: true,
            transparent: true,
            opacity: 0,
            depthWrite: false,
          })
        );
        threeScene.add(mesh);
        s = { mesh, t: 0, life: 1.4, maxR: 1.2, active: false };
        shellsRef.current.push(s);
      }
      return s;
    }

    function resize() {
      const w = el.clientWidth;
      const h = el.clientHeight;
      renderer.setSize(w, h, true);
      camera.aspect = w / Math.max(h, 1);
      camera.updateProjectionMatrix();
    }
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);

    let raf = 0;
    const clock = new THREE.Clock();

    const animate = () => {
      raf = requestAnimationFrame(animate);
      const dt = Math.min(clock.getDelta(), 0.05);
      const t = clock.elapsedTime;
      const snap = sceneRef.current;

      if (snap) {
        // Per-board LED + chart history from real link samples only
        chartAcc.current += dt;
        const updateCharts = chartAcc.current > 0.12;
        if (updateCharts) chartAcc.current = 0;

        boardsRef.current.forEach((bv, i) => {
          const node = snap.nodes.find((n) => n.board_id === bv.boardId);
          const online = node?.connection === "online";
          const live = linkForBoard(snap, bv.boardId);
          const ledMat = bv.led.material as THREE.MeshBasicMaterial;
          ledMat.color.setHex(online ? 0x3ecf8e : 0x5e584f);

          const pulseRate =
            live?.motion_score != null &&
            live.motion_threshold != null &&
            live.motion_score > live.motion_threshold
              ? 7
              : 2.2;
          bv.led.scale.setScalar(0.85 + 0.2 * Math.sin(t * pulseRate + i));

          if (updateCharts) {
            if (live?.rssi_dbm != null) {
              bv.history.push(live.rssi_dbm);
              if (bv.history.length > 48) bv.history.shift();
            }
            drawBoardChart(
              bv.chartCtx,
              bv.chartTex,
              bv.boardId,
              bv.history,
              live,
              !!online
            );
          }
        });

        // Measured link styling from real scores
        snap.links.forEach((l) => {
          const mat = linkMats.current[l.link_id];
          if (!mat) return;
          if (l.quality === "unavailable" || l.rssi_dbm == null) {
            mat.opacity = 0.1;
            mat.color.setHex(0x5e584f);
            return;
          }
          const hot =
            l.motion_score != null &&
            l.motion_threshold != null &&
            l.motion_score > l.motion_threshold;
          mat.opacity = hot ? 0.9 : 0.35 + Math.min(0.35, (l.presence_score ?? 0) * 0.12);
          mat.color.setHex(hot ? 0x3ecf8e : 0x6aa3d8);
        });

        // Spawn wave shells from boards with real CSI activity
        spawnAcc.current += dt;
        const anyHot = snap.links.some(
          (l) =>
            l.motion_score != null &&
            l.motion_threshold != null &&
            l.motion_score > l.motion_threshold
        );
        const interval = anyHot ? 0.35 : 0.9;
        if (spawnAcc.current >= interval) {
          spawnAcc.current = 0;
          boardsRef.current.forEach((bv) => {
            const node = snap.nodes.find((n) => n.board_id === bv.boardId);
            if (node?.connection !== "online") return;
            const live = linkForBoard(snap, bv.boardId);
            if (!live || live.rssi_dbm == null) return;
            const shell = acquireShell();
            if (!shell) return;
            shell.active = true;
            shell.t = 0;
            const activity = Math.min(
              1.4,
              (live.motion_score ?? 0.2) / Math.max(live.motion_threshold ?? 0.8, 0.1)
            );
            shell.life = 1.2 + activity * 0.4;
            shell.maxR = 0.7 + activity * 0.9;
            shell.mesh.position.copy(bv.worldPos);
            shell.mesh.scale.setScalar(0.08);
            shell.mesh.visible = true;
            const mat = shell.mesh.material as THREE.MeshBasicMaterial;
            mat.color.setHex(activity > 1 ? 0x3ecf8e : 0xe8722c);
            mat.opacity = 0.35;
          });
        }

        // Person track — only if provider sent a position
        const track = snap.tracks[0];
        const motionMax = Math.max(
          0,
          ...snap.links.map((l) => l.motion_score ?? 0)
        );
        const motionTh = Math.max(
          0.01,
          ...snap.links.map((l) => l.motion_threshold ?? 0.8)
        );
        const bounce = Math.min(1.6, motionMax / motionTh);

        if (track && avatarRef.current) {
          avatarRef.current.visible = true;
          const p = toThree(track.position.x_m, track.position.y_m, 0);
          avatarRef.current.position.lerp(p, 0.28);
          if (track.heading_rad != null) {
            avatarRef.current.rotation.y = -track.heading_rad + Math.PI / 2;
          }
          trailPts.current.push(p.clone());
          if (trailPts.current.length > 70) trailPts.current.shift();
          trailRef.current!.geometry.setFromPoints(trailPts.current);

          // Rings bounce out from floor position — amplitude from measured motion
          personRingsRef.current.forEach((ring, i) => {
            ring.visible = true;
            const phase = (t * (0.7 + bounce * 0.6) + i * 0.55) % 1.8;
            const s = 0.4 + phase * (1.2 + bounce);
            ring.position.set(p.x, 0.03, p.z);
            ring.scale.setScalar(s);
            (ring.material as THREE.MeshBasicMaterial).opacity =
              0.4 * (1 - phase / 1.8) * Math.min(1, 0.35 + bounce * 0.4);
          });
        } else if (avatarRef.current) {
          avatarRef.current.visible = false;
          trailPts.current = [];
          trailRef.current!.geometry.setFromPoints([]);
          personRingsRef.current.forEach((ring) => {
            ring.visible = false;
            (ring.material as THREE.MeshBasicMaterial).opacity = 0;
          });
        }
      }

      // Expand shells
      for (const s of shellsRef.current) {
        if (!s.active) continue;
        s.t += dt;
        const k = s.t / s.life;
        s.mesh.scale.setScalar(0.1 + k * s.maxR);
        (s.mesh.material as THREE.MeshBasicMaterial).opacity = 0.32 * (1 - k);
        if (s.t >= s.life) {
          s.active = false;
          s.mesh.visible = false;
        }
      }

      controls.update();
      renderer.render(threeScene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
      shellsRef.current.forEach((s) => {
        threeScene.remove(s.mesh);
        (s.mesh.material as THREE.Material).dispose();
      });
      shellsRef.current = [];
      shellGeo.current?.dispose();
      if (renderer.domElement.parentElement === el) el.removeChild(renderer.domElement);
    };
  }, [layout]);

  return <div ref={mountRef} className="absolute inset-0" />;
}
