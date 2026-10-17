"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { LinkMetrics, RoomLayout, SceneSnapshot } from "@/lib/types";

/** room_local_z_up → Three.js Y-up */
function toThree(x: number, y: number, z: number): THREE.Vector3 {
  return new THREE.Vector3(x, z, -y);
}

const C = {
  canvas: 0x0f0e0c,
  floor: 0x141210,
  gridMajor: 0x3a3530,
  gridMinor: 0x24201c,
  paper: 0x1a1814,
  line: 0x3d3932,
  muted: 0x8f887c,
  ink: 0xf0ebe3,
  orange: 0xe8722c,
  orangeSoft: 0xf0a06a,
  green: 0x3ecf8e,
  blue: 0x8a9bb0,
};

type Props = { layout: RoomLayout; scene: SceneSnapshot | null };

type Shell = {
  mesh: THREE.Mesh;
  t: number;
  life: number;
  maxR: number;
  active: boolean;
};

type BoardViz = {
  boardId: string;
  group: THREE.Group;
  led: THREE.Mesh;
  boardMat: THREE.MeshStandardMaterial;
  chartSprite: THREE.Sprite;
  chartCtx: CanvasRenderingContext2D;
  chartTex: THREE.CanvasTexture;
  history: number[];
  worldPos: THREE.Vector3;
};

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
  if (boardId === "b1") {
    const links = snap.links.filter((l) => l.rssi_dbm != null);
    if (!links.length) return null;
    return links.reduce((a, b) =>
      (a.motion_score ?? 0) >= (b.motion_score ?? 0) ? a : b
    );
  }
  return snap.links.find((l) => l.link_id === `b1-${boardId}`) || null;
}

function drawBoardChart(
  ctx: CanvasRenderingContext2D,
  tex: THREE.CanvasTexture,
  boardId: string,
  history: number[],
  live: LinkMetrics | null,
  online: boolean
) {
  const w = 176;
  const h = 80;
  ctx.clearRect(0, 0, w, h);

  // Soft card matching console paper
  ctx.fillStyle = "rgba(23, 21, 18, 0.92)";
  ctx.strokeStyle = "rgba(61, 57, 50, 0.95)";
  ctx.lineWidth = 1.25;
  roundRect(ctx, 1, 1, w - 2, h - 2, 8);
  ctx.fill();
  ctx.stroke();

  // Accent hairline
  ctx.fillStyle = online ? "rgba(232, 114, 44, 0.85)" : "rgba(94, 88, 79, 0.6)";
  ctx.fillRect(1, 1, 3, h - 2);

  ctx.fillStyle = online ? "#f0ebe3" : "#8f887c";
  ctx.font = "600 12px ui-sans-serif, system-ui, sans-serif";
  ctx.fillText(boardId.toUpperCase(), 12, 16);

  ctx.font = "500 11px ui-monospace, Menlo, monospace";
  ctx.textAlign = "right";
  if (live?.rssi_dbm != null) {
    ctx.fillStyle = "#c9c2b6";
    ctx.fillText(`${live.rssi_dbm.toFixed(1)} dBm`, w - 10, 16);
  } else {
    ctx.fillStyle = "#5e584f";
    ctx.fillText("no CSI", w - 10, 16);
  }
  ctx.textAlign = "left";

  const vals = history.filter((v) => Number.isFinite(v));
  const top = 24;
  const bottom = h - 14;
  const left = 12;
  const right = w - 12;

  if (vals.length >= 2) {
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const span = max - min || 1;

    // Fill under curve
    ctx.beginPath();
    history.forEach((v, i) => {
      if (!Number.isFinite(v)) return;
      const x = left + (i / Math.max(history.length - 1, 1)) * (right - left);
      const y = bottom - ((v - min) / span) * (bottom - top);
      if (i === 0 || !Number.isFinite(history[i - 1])) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    const lastX = left + ((history.length - 1) / Math.max(history.length - 1, 1)) * (right - left);
    ctx.lineTo(lastX, bottom);
    ctx.lineTo(left, bottom);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, top, 0, bottom);
    grad.addColorStop(0, "rgba(232, 114, 44, 0.28)");
    grad.addColorStop(1, "rgba(232, 114, 44, 0)");
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.strokeStyle = "#e8722c";
    ctx.lineWidth = 1.6;
    ctx.lineJoin = "round";
    ctx.beginPath();
    history.forEach((v, i) => {
      if (!Number.isFinite(v)) return;
      const x = left + (i / Math.max(history.length - 1, 1)) * (right - left);
      const y = bottom - ((v - min) / span) * (bottom - top);
      if (i === 0 || !Number.isFinite(history[i - 1])) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  } else {
    ctx.fillStyle = "#5e584f";
    ctx.font = "11px system-ui, sans-serif";
    ctx.fillText("collecting samples…", 12, 48);
  }

  // Motion vs threshold — real scores only
  if (live?.motion_score != null && live.motion_threshold != null) {
    const ratio = Math.min(1.4, live.motion_score / Math.max(live.motion_threshold, 0.01));
    ctx.fillStyle = "rgba(44, 41, 36, 0.95)";
    roundRect(ctx, 12, h - 9, w - 24, 4, 2);
    ctx.fill();
    ctx.fillStyle = ratio > 1 ? "#3ecf8e" : "#e8722c";
    roundRect(ctx, 12, h - 9, Math.max(2, (w - 24) * Math.min(1, ratio)), 4, 2);
    ctx.fill();
  }

  tex.needsUpdate = true;
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
      alpha: false,
    });
    renderer.setClearColor(C.canvas, 1);
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    el.appendChild(renderer.domElement);

    const threeScene = new THREE.Scene();
    threeScene.fog = new THREE.Fog(C.canvas, 10, 26);

    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 80);
    camera.position.set(5.8, 5.6, 7.2);
    camera.lookAt(2, 0.7, -1.5);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(2, 0.55, -1.5);
    controls.enableDamping = true;
    controls.dampingFactor = 0.07;
    controls.minDistance = 4.5;
    controls.maxDistance = 16;
    controls.maxPolarAngle = Math.PI * 0.44;
    controls.enablePan = false;
    controls.update();

    threeScene.add(new THREE.AmbientLight(0xc4b8a8, 0.45));
    const key = new THREE.DirectionalLight(0xfff2e0, 0.7);
    key.position.set(3, 9, 4);
    threeScene.add(key);
    const rim = new THREE.DirectionalLight(0xe8722c, 0.18);
    rim.position.set(-4, 3, -2);
    threeScene.add(rim);

    const fb = layout.floor_bounds;
    const fw = fb.max_x - fb.min_x;
    const fd = fb.max_y - fb.min_y;
    const cx = (fb.min_x + fb.max_x) / 2;
    const cy = (fb.min_y + fb.max_y) / 2;

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(fw, fd),
      new THREE.MeshStandardMaterial({
        color: C.floor,
        roughness: 0.92,
        metalness: 0.05,
      })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.copy(toThree(cx, cy, 0));
    threeScene.add(floor);

    const grid = new THREE.GridHelper(Math.max(fw, fd), 12, C.gridMajor, C.gridMinor);
    grid.position.copy(floor.position);
    const gMat = grid.material as THREE.Material | THREE.Material[];
    if (Array.isArray(gMat)) gMat.forEach((m) => { m.transparent = true; (m as THREE.LineBasicMaterial).opacity = 0.55; });
    else {
      gMat.transparent = true;
      (gMat as THREE.LineBasicMaterial).opacity = 0.55;
    }
    threeScene.add(grid);

    // Soft floor plate edge
    const plate = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.PlaneGeometry(fw, fd)),
      new THREE.LineBasicMaterial({ color: C.line, transparent: true, opacity: 0.7 })
    );
    plate.rotation.x = -Math.PI / 2;
    plate.position.copy(toThree(cx, cy, 0.01));
    threeScene.add(plate);

    // Triangle geometry (not a measured B2–B3 link)
    const poly = layout.monitored_polygon_xy;
    const triPts = [...poly, poly[0]].map(([x, y]) => toThree(x, y, 0.025));
    threeScene.add(
      new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(triPts),
        new THREE.LineBasicMaterial({ color: C.muted, transparent: true, opacity: 0.45 })
      )
    );

    shellGeo.current = new THREE.SphereGeometry(1, 20, 14);
    boardsRef.current = [];

    layout.boards.forEach((b) => {
      const [x, y, z] = b.position_m;
      const g = new THREE.Group();
      const worldPos = toThree(x, y, z);
      g.position.copy(worldPos);

      const boardMat = new THREE.MeshStandardMaterial({
        color: 0x1c1a17,
        emissive: C.orange,
        emissiveIntensity: 0.08,
        metalness: 0.4,
        roughness: 0.4,
      });
      const board = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.3, 0.07), boardMat);
      g.add(board);

      // subtle PCB edge
      g.add(
        new THREE.LineSegments(
          new THREE.EdgesGeometry(new THREE.BoxGeometry(0.14, 0.3, 0.07)),
          new THREE.LineBasicMaterial({ color: 0x4a453e, transparent: true, opacity: 0.8 })
        )
      );

      const led = new THREE.Mesh(
        new THREE.SphereGeometry(0.028, 12, 10),
        new THREE.MeshBasicMaterial({ color: C.green })
      );
      led.position.set(0.04, 0.12, 0.045);
      g.add(led);

      const cv = document.createElement("canvas");
      cv.width = 176;
      cv.height = 80;
      const ctx = cv.getContext("2d")!;
      const chartTex = new THREE.CanvasTexture(cv);
      chartTex.colorSpace = THREE.SRGBColorSpace;
      const chartSprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: chartTex,
          transparent: true,
          depthTest: false,
          depthWrite: false,
        })
      );
      chartSprite.scale.set(1.05, 0.48, 1);
      chartSprite.position.set(0, 0.58, 0);
      g.add(chartSprite);

      threeScene.add(
        new THREE.Line(
          new THREE.BufferGeometry().setFromPoints([
            toThree(x, y, 0),
            toThree(x, y, z),
          ]),
          new THREE.LineBasicMaterial({ color: C.line, transparent: true, opacity: 0.4 })
        )
      );
      threeScene.add(g);

      boardsRef.current.push({
        boardId: b.board_id,
        group: g,
        led,
        boardMat,
        chartSprite,
        chartCtx: ctx,
        chartTex,
        history: [],
        worldPos: worldPos.clone(),
      });
      drawBoardChart(ctx, chartTex, b.board_id, [], null, true);
    });

    layout.sensing_links
      .filter((l) => l.enabled)
      .forEach((link) => {
        const tx = layout.boards.find((b) => b.board_id === link.tx_board_id)!;
        const rx = layout.boards.find((b) => b.board_id === link.rx_board_id)!;
        const mat = new THREE.LineBasicMaterial({
          color: C.blue,
          transparent: true,
          opacity: 0.35,
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

    const avatar = new THREE.Group();
    const skin = new THREE.MeshStandardMaterial({
      color: C.green,
      emissive: 0x1a5c3d,
      emissiveIntensity: 0.22,
      roughness: 0.45,
      metalness: 0.08,
      transparent: true,
      opacity: 0.94,
    });
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.45, 6, 12), skin);
    torso.position.y = 1.05;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 14, 12), skin);
    head.position.y = 1.48;
    const legs = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.65, 10), skin);
    legs.position.y = 0.38;
    const feet = new THREE.Mesh(
      new THREE.RingGeometry(0.2, 0.28, 40),
      new THREE.MeshBasicMaterial({
        color: C.green,
        transparent: true,
        opacity: 0.65,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    feet.rotation.x = -Math.PI / 2;
    feet.position.y = 0.03;
    avatar.add(torso, head, legs, feet);
    avatar.visible = false;
    threeScene.add(avatar);
    avatarRef.current = avatar;

    personRingsRef.current = [];
    for (let i = 0; i < 4; i++) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.12, 0.16, 56),
        new THREE.MeshBasicMaterial({
          color: C.green,
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
      new THREE.LineBasicMaterial({ color: C.green, transparent: true, opacity: 0.35 })
    );
    threeScene.add(trail);
    trailRef.current = trail;

    function acquireShell(): Shell | null {
      let s = shellsRef.current.find((x) => !x.active);
      if (!s) {
        if (shellsRef.current.length >= 12) return null;
        const mesh = new THREE.Mesh(
          shellGeo.current!,
          new THREE.MeshBasicMaterial({
            color: C.orange,
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
        chartAcc.current += dt;
        const updateCharts = chartAcc.current > 0.1;
        if (updateCharts) chartAcc.current = 0;

        boardsRef.current.forEach((bv, i) => {
          const node = snap.nodes.find((n) => n.board_id === bv.boardId);
          const online = node?.connection === "online";
          const live = linkForBoard(snap, bv.boardId);
          (bv.led.material as THREE.MeshBasicMaterial).color.setHex(
            online ? C.green : C.muted
          );
          bv.boardMat.emissiveIntensity = online
            ? 0.1 + 0.08 * Math.sin(t * 2 + i)
            : 0.02;

          const hot =
            live?.motion_score != null &&
            live.motion_threshold != null &&
            live.motion_score > live.motion_threshold;
          bv.led.scale.setScalar(0.9 + 0.22 * Math.sin(t * (hot ? 7 : 2.2) + i));

          // Gentle chart bob
          bv.chartSprite.position.y = 0.58 + Math.sin(t * 1.1 + i) * 0.02;

          if (updateCharts) {
            if (live?.rssi_dbm != null) {
              bv.history.push(live.rssi_dbm);
              if (bv.history.length > 52) bv.history.shift();
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

        snap.links.forEach((l) => {
          const mat = linkMats.current[l.link_id];
          if (!mat) return;
          if (l.quality === "unavailable" || l.rssi_dbm == null) {
            mat.opacity = 0.08;
            mat.color.setHex(C.muted);
            return;
          }
          const hot =
            l.motion_score != null &&
            l.motion_threshold != null &&
            l.motion_score > l.motion_threshold;
          mat.opacity = hot
            ? 0.85
            : 0.28 + Math.min(0.4, (l.presence_score ?? 0) * 0.15);
          mat.color.setHex(hot ? C.green : C.orangeSoft);
        });

        spawnAcc.current += dt;
        const anyHot = snap.links.some(
          (l) =>
            l.motion_score != null &&
            l.motion_threshold != null &&
            l.motion_score > l.motion_threshold
        );
        if (spawnAcc.current >= (anyHot ? 0.32 : 0.85)) {
          spawnAcc.current = 0;
          boardsRef.current.forEach((bv) => {
            const node = snap.nodes.find((n) => n.board_id === bv.boardId);
            if (node?.connection !== "online") return;
            const live = linkForBoard(snap, bv.boardId);
            if (!live || live.rssi_dbm == null) return;
            const shell = acquireShell();
            if (!shell) return;
            const activity = Math.min(
              1.5,
              (live.motion_score ?? 0.2) / Math.max(live.motion_threshold ?? 0.8, 0.1)
            );
            shell.active = true;
            shell.t = 0;
            shell.life = 1.15 + activity * 0.45;
            shell.maxR = 0.65 + activity * 0.95;
            shell.mesh.position.copy(bv.worldPos);
            shell.mesh.scale.setScalar(0.06);
            shell.mesh.visible = true;
            const mat = shell.mesh.material as THREE.MeshBasicMaterial;
            mat.color.setHex(activity > 1 ? C.green : C.orange);
            mat.opacity = 0.28;
          });
        }

        const track = snap.tracks[0];
        const motionMax = Math.max(0, ...snap.links.map((l) => l.motion_score ?? 0));
        const motionTh = Math.max(
          0.01,
          ...snap.links.map((l) => l.motion_threshold ?? 0.8)
        );
        const bounce = Math.min(1.7, motionMax / motionTh);

        if (track && avatarRef.current) {
          avatarRef.current.visible = true;
          const p = toThree(track.position.x_m, track.position.y_m, 0);
          avatarRef.current.position.lerp(p, 0.28);
          if (track.heading_rad != null) {
            avatarRef.current.rotation.y = -track.heading_rad + Math.PI / 2;
          }
          trailPts.current.push(p.clone());
          if (trailPts.current.length > 64) trailPts.current.shift();
          trailRef.current!.geometry.setFromPoints(trailPts.current);

          personRingsRef.current.forEach((ring, i) => {
            ring.visible = true;
            const phase = (t * (0.65 + bounce * 0.55) + i * 0.45) % 1.7;
            ring.position.set(p.x, 0.028, p.z);
            ring.scale.setScalar(0.35 + phase * (1.35 + bounce * 0.35));
            (ring.material as THREE.MeshBasicMaterial).opacity =
              0.42 * (1 - phase / 1.7) * Math.min(1, 0.3 + bounce * 0.45);
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

      for (const s of shellsRef.current) {
        if (!s.active) continue;
        s.t += dt;
        const k = s.t / s.life;
        s.mesh.scale.setScalar(0.08 + k * s.maxR);
        (s.mesh.material as THREE.MeshBasicMaterial).opacity = 0.28 * (1 - k);
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
