"use client";

/**
 * Semi-precise sensing twin.
 * Research-backed rules applied here:
 * - Spatialize metrics at the physical boards (not free-floating chrome)
 * - Only draw measured links (b1→b2, b1→b3); triangle outline ≠ RF edge
 * - Floor field = relative activity from real link scores near segments
 * - Color encodes threshold state; no decorative rainbow
 * - Avatar only when provider supplies a floor track
 */

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { computeFieldGrid, scoreToColor } from "@/lib/signalField";
import type { LinkMetrics, RoomLayout, SceneSnapshot } from "@/lib/types";

function toThree(x: number, y: number, z: number): THREE.Vector3 {
  return new THREE.Vector3(x, z, -y);
}

const THEME = {
  canvas: 0x0f0e0c,
  floor: 0x13110f,
  wall: 0x1a1815,
  gridMajor: 0x3a3530,
  gridMinor: 0x24201c,
  line: 0x3d3932,
  muted: 0x8f887c,
  orange: 0xe8722c,
  orangeSoft: 0xf0a06a,
  green: 0x3ecf8e,
  ink: 0xf0ebe3,
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
  role: string;
  led: THREE.Mesh;
  boardMat: THREE.MeshStandardMaterial;
  labelSprite: THREE.Sprite;
  labelCtx: CanvasRenderingContext2D;
  labelTex: THREE.CanvasTexture;
  worldPos: THREE.Vector3;
};

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

function drawLabel(
  ctx: CanvasRenderingContext2D,
  tex: THREE.CanvasTexture,
  boardId: string,
  role: string,
  live: LinkMetrics | null,
  online: boolean
) {
  const w = 168;
  const h = 56;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "rgba(23,21,18,0.94)";
  ctx.strokeStyle = "rgba(61,57,50,0.95)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(0.5, 0.5, w - 1, h - 1, 6);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = online ? "#e8722c" : "#5e584f";
  ctx.fillRect(1, 1, 3, h - 2);

  ctx.fillStyle = online ? "#f0ebe3" : "#8f887c";
  ctx.font = "650 13px system-ui,sans-serif";
  ctx.fillText(boardId.toUpperCase(), 12, 18);
  ctx.fillStyle = "#8f887c";
  ctx.font = "500 10px system-ui,sans-serif";
  ctx.fillText(role === "transmitter_hub" ? "TX · hub" : "RX · CSI", 12, 32);

  ctx.textAlign = "right";
  ctx.font = "600 12px ui-monospace,Menlo,monospace";
  if (live?.rssi_dbm != null) {
    ctx.fillStyle = "#c9c2b6";
    ctx.fillText(`${live.rssi_dbm.toFixed(1)} dBm`, w - 10, 18);
  } else {
    ctx.fillStyle = "#5e584f";
    ctx.fillText("—", w - 10, 18);
  }
  ctx.font = "500 10px ui-monospace,Menlo,monospace";
  if (live?.motion_score != null && live.motion_threshold != null) {
    const hot = live.motion_score > live.motion_threshold;
    ctx.fillStyle = hot ? "#3ecf8e" : "#8f887c";
    ctx.fillText(
      `m ${live.motion_score.toFixed(2)}`,
      w - 10,
      34
    );
  }
  ctx.textAlign = "left";

  if (live?.motion_score != null && live.motion_threshold != null) {
    const r = Math.min(1.2, live.motion_score / Math.max(live.motion_threshold, 0.01));
    ctx.fillStyle = "rgba(44,41,36,0.95)";
    ctx.fillRect(12, h - 10, w - 24, 3);
    ctx.fillStyle = r > 1 ? "#3ecf8e" : "#e8722c";
    ctx.fillRect(12, h - 10, (w - 24) * Math.min(1, r), 3);
  }
  tex.needsUpdate = true;
}

function makeDiscTexture() {
  const cv = document.createElement("canvas");
  cv.width = 64;
  cv.height = 64;
  const ctx = cv.getContext("2d")!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.4, "rgba(255,255,255,0.75)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeEspMesh(role: "transmitter_hub" | "receiver") {
  const g = new THREE.Group();
  const bb = new THREE.Mesh(
    new THREE.BoxGeometry(0.16, 0.016, 0.1),
    new THREE.MeshStandardMaterial({ color: 0xe4dfd6, roughness: 0.78, metalness: 0.04 })
  );
  bb.position.y = 0.008;
  g.add(bb);
  const pcb = new THREE.Mesh(
    new THREE.BoxGeometry(0.05, 0.01, 0.026),
    new THREE.MeshStandardMaterial({
      color: 0x1a1e24,
      metalness: 0.45,
      roughness: 0.4,
      emissive: THEME.orange,
      emissiveIntensity: 0.1,
    })
  );
  pcb.position.set(0, 0.018, 0);
  g.add(pcb);
  const ant = new THREE.Mesh(
    new THREE.CylinderGeometry(0.0018, 0.0018, 0.05, 6),
    new THREE.MeshStandardMaterial({ color: 0x9a948b, metalness: 0.8, roughness: 0.25 })
  );
  ant.position.set(0.028, 0.045, 0);
  g.add(ant);
  if (role === "transmitter_hub") {
    const ant2 = ant.clone();
    ant2.position.x = -0.028;
    g.add(ant2);
  }
  return { group: g, pcb };
}

export default function RoomScene({ layout, scene }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<SceneSnapshot | null>(null);
  const avatarRef = useRef<THREE.Group | null>(null);
  const trailRef = useRef<THREE.Line | null>(null);
  const trailPts = useRef<THREE.Vector3[]>([]);
  const linkMats = useRef<Record<string, THREE.MeshBasicMaterial>>({});
  const boardsRef = useRef<BoardViz[]>([]);
  const shellsRef = useRef<Shell[]>([]);
  const personRingsRef = useRef<THREE.Mesh[]>([]);
  const fieldRef = useRef<THREE.Points | null>(null);
  const fieldColors = useRef<Float32Array | null>(null);
  const fieldPos = useRef<Float32Array | null>(null);
  const fieldMeta = useRef<{ nx: number; ny: number; cellX: number; cellY: number } | null>(null);
  const shellGeo = useRef<THREE.SphereGeometry | null>(null);
  const spawnAcc = useRef(0);
  const labelAcc = useRef(0);
  const fieldAcc = useRef(0);
  const tmpColor = useRef({ r: 0, g: 0, b: 0 });

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
    renderer.setClearColor(THEME.canvas, 1);
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    el.appendChild(renderer.domElement);

    const threeScene = new THREE.Scene();
    threeScene.fog = new THREE.Fog(THEME.canvas, 13, 26);

    const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 80);
    camera.position.set(5.6, 4.5, 6.6);
    camera.lookAt(2, 0.55, -1.5);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(2, 0.55, -1.5);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 4.5;
    controls.maxDistance = 14;
    controls.maxPolarAngle = Math.PI * 0.42;
    controls.enablePan = false;
    controls.update();

    threeScene.add(new THREE.AmbientLight(0xc4b8a8, 0.48));
    const key = new THREE.DirectionalLight(0xfff2e0, 0.78);
    key.position.set(4, 10, 5);
    threeScene.add(key);
    const fill = new THREE.DirectionalLight(0xe8722c, 0.1);
    fill.position.set(-5, 2, -3);
    threeScene.add(fill);
    const rim = new THREE.DirectionalLight(0xb8d4c8, 0.08);
    rim.position.set(0, 3, -8);
    threeScene.add(rim);

    const fb = layout.floor_bounds;
    const fw = fb.max_x - fb.min_x;
    const fd = fb.max_y - fb.min_y;
    const cx = (fb.min_x + fb.max_x) / 2;
    const cy = (fb.min_y + fb.max_y) / 2;
    const roomH = 2.7;

    // Floor
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(fw, fd),
      new THREE.MeshStandardMaterial({ color: THEME.floor, roughness: 0.92, metalness: 0.04 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.copy(toThree(cx, cy, 0));
    threeScene.add(floor);

    const grid = new THREE.GridHelper(Math.max(fw, fd), 12, THEME.gridMajor, THEME.gridMinor);
    grid.position.copy(floor.position);
    const gm = grid.material as THREE.LineBasicMaterial | THREE.LineBasicMaterial[];
    (Array.isArray(gm) ? gm : [gm]).forEach((m) => {
      m.transparent = true;
      m.opacity = 0.28;
    });
    threeScene.add(grid);

    // Room enclosure — edges only, walls nearly invisible
    const wallMat = new THREE.MeshStandardMaterial({
      color: THEME.wall,
      transparent: true,
      opacity: 0.07,
      roughness: 0.95,
      metalness: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const edgeMat = new THREE.LineBasicMaterial({
      color: THEME.line,
      transparent: true,
      opacity: 0.55,
    });
    const roomBox = new THREE.BoxGeometry(fw, roomH, fd);
    const roomMesh = new THREE.Mesh(roomBox, wallMat);
    roomMesh.position.copy(toThree(cx, cy, roomH / 2));
    threeScene.add(roomMesh);
    const roomEdges = new THREE.LineSegments(new THREE.EdgesGeometry(roomBox), edgeMat);
    roomEdges.position.copy(roomMesh.position);
    threeScene.add(roomEdges);

    // Monitored triangle — soft fill + outline
    const poly = layout.monitored_polygon_xy;
    const shape = new THREE.Shape();
    poly.forEach(([x, y], i) => {
      const p = toThree(x, y, 0);
      if (i === 0) shape.moveTo(p.x, -p.z);
      else shape.lineTo(p.x, -p.z);
    });
    shape.closePath();
    const zone = new THREE.Mesh(
      new THREE.ShapeGeometry(shape),
      new THREE.MeshBasicMaterial({
        color: THEME.orange,
        transparent: true,
        opacity: 0.045,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
    );
    zone.rotation.x = -Math.PI / 2;
    zone.position.y = 0.02;
    threeScene.add(zone);

    const triPts = [...poly, poly[0]].map(([x, y]) => toThree(x, y, 0.025));
    threeScene.add(
      new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(triPts),
        new THREE.LineBasicMaterial({ color: THEME.muted, transparent: true, opacity: 0.4 })
      )
    );

    // Edge length labels — pushed outside the triangle so they don't fight the avatar
    const cxPoly = poly.reduce((s, p) => s + p[0], 0) / poly.length;
    const cyPoly = poly.reduce((s, p) => s + p[1], 0) / poly.length;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const mx = (a[0] + b[0]) / 2;
      const my = (a[1] + b[1]) / 2;
      const ox = mx - cxPoly;
      const oy = my - cyPoly;
      const olen = Math.hypot(ox, oy) || 1;
      const lx = mx + (ox / olen) * 0.32;
      const ly = my + (oy / olen) * 0.32;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const cv = document.createElement("canvas");
      cv.width = 88;
      cv.height = 26;
      const ctx = cv.getContext("2d")!;
      ctx.fillStyle = "rgba(15,14,12,0.55)";
      ctx.beginPath();
      ctx.roundRect(0, 0, 88, 26, 4);
      ctx.fill();
      ctx.fillStyle = "#6e675c";
      ctx.font = "600 13px ui-monospace,Menlo,monospace";
      ctx.textAlign = "center";
      ctx.fillText(`${len.toFixed(2)} m`, 44, 17);
      const spr = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: new THREE.CanvasTexture(cv),
          transparent: true,
          depthTest: false,
          opacity: 0.85,
        })
      );
      spr.scale.set(0.48, 0.14, 1);
      spr.position.copy(toThree(lx, ly, 0.08));
      threeScene.add(spr);
    }

    // Signal field points
    const nx = 30;
    const ny = 24;
    const cellX = fw / nx;
    const cellY = fd / ny;
    fieldMeta.current = { nx, ny, cellX, cellY };
    const nPts = nx * ny;
    const positions = new Float32Array(nPts * 3);
    const colors = new Float32Array(nPts * 3);
    let pi = 0;
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const x = fb.min_x + (i + 0.5) * cellX;
        const y = fb.min_y + (j + 0.5) * cellY;
        const p = toThree(x, y, 0.04);
        positions[pi * 3] = p.x;
        positions[pi * 3 + 1] = p.y;
        positions[pi * 3 + 2] = p.z;
        colors[pi * 3] = 0.1;
        colors[pi * 3 + 1] = 0.09;
        colors[pi * 3 + 2] = 0.08;
        pi++;
      }
    }
    fieldPos.current = positions;
    fieldColors.current = colors;
    const fieldGeo = new THREE.BufferGeometry();
    fieldGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    fieldGeo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const field = new THREE.Points(
      fieldGeo,
      new THREE.PointsMaterial({
        size: 0.2,
        map: makeDiscTexture(),
        vertexColors: true,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        sizeAttenuation: true,
        blending: THREE.AdditiveBlending,
      })
    );
    threeScene.add(field);
    fieldRef.current = field;

    shellGeo.current = new THREE.SphereGeometry(1, 18, 12);
    boardsRef.current = [];

    layout.boards.forEach((b) => {
      const [x, y, z] = b.position_m;
      const worldPos = toThree(x, y, z);
      const { group, pcb } = makeEspMesh(b.role);
      group.position.copy(worldPos);
      // Sit board on mount height — model local origin at PCB
      group.position.y = z;

      const led = new THREE.Mesh(
        new THREE.SphereGeometry(0.006, 10, 8),
        new THREE.MeshBasicMaterial({ color: THEME.green })
      );
      led.position.set(0.02, 0.032, 0.012);
      group.add(led);

      const cv = document.createElement("canvas");
      cv.width = 168;
      cv.height = 56;
      const ctx = cv.getContext("2d")!;
      const labelTex = new THREE.CanvasTexture(cv);
      labelTex.colorSpace = THREE.SRGBColorSpace;
      const labelSprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: labelTex,
          transparent: true,
          depthTest: false,
          depthWrite: false,
        })
      );
      labelSprite.scale.set(0.82, 0.27, 1);
      labelSprite.position.set(0, 0.32, 0);
      group.add(labelSprite);

      // Drop to floor
      threeScene.add(
        new THREE.Line(
          new THREE.BufferGeometry().setFromPoints([
            toThree(x, y, 0),
            toThree(x, y, z),
          ]),
          new THREE.LineBasicMaterial({
            color: THEME.line,
            transparent: true,
            opacity: 0.45,
          })
        )
      );

      // Mount pole stub
      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.012, 0.014, z, 8),
        new THREE.MeshStandardMaterial({ color: 0x2a2722, roughness: 0.7, metalness: 0.2 })
      );
      pole.position.copy(toThree(x, y, z / 2));
      threeScene.add(pole);

      threeScene.add(group);
      boardsRef.current.push({
        boardId: b.board_id,
        role: b.role,
        led,
        boardMat: pcb.material as THREE.MeshStandardMaterial,
        labelSprite,
        labelCtx: ctx,
        labelTex,
        worldPos: worldPos.clone(),
      });
      drawLabel(ctx, labelTex, b.board_id, b.role, null, true);
    });

    // Measured sensing links as thin tubes
    layout.sensing_links
      .filter((l) => l.enabled)
      .forEach((link) => {
        const tx = layout.boards.find((b) => b.board_id === link.tx_board_id)!;
        const rx = layout.boards.find((b) => b.board_id === link.rx_board_id)!;
        const a = toThree(...tx.position_m);
        const b = toThree(...rx.position_m);
        const dir = new THREE.Vector3().subVectors(b, a);
        const len = dir.length();
        const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
        const mat = new THREE.MeshBasicMaterial({
          color: THEME.orangeSoft,
          transparent: true,
          opacity: 0.28,
        });
        linkMats.current[link.link_id] = mat;
        const tube = new THREE.Mesh(
          new THREE.CylinderGeometry(0.009, 0.009, len, 10, 1, true),
          mat
        );
        tube.position.copy(mid);
        tube.quaternion.setFromUnitVectors(
          new THREE.Vector3(0, 1, 0),
          dir.clone().normalize()
        );
        threeScene.add(tube);
      });

    // Avatar — only when track exists
    const avatar = new THREE.Group();
    const skin = new THREE.MeshStandardMaterial({
      color: THEME.green,
      emissive: 0x145038,
      emissiveIntensity: 0.2,
      roughness: 0.5,
      metalness: 0.05,
      transparent: true,
      opacity: 0.92,
    });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.58, 6, 14), skin);
    body.position.y = 0.98;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.1, 14, 12), skin);
    head.position.y = 1.48;
    const feet = new THREE.Mesh(
      new THREE.RingGeometry(0.18, 0.24, 48),
      new THREE.MeshBasicMaterial({
        color: THEME.green,
        transparent: true,
        opacity: 0.55,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    feet.rotation.x = -Math.PI / 2;
    feet.position.y = 0.025;
    avatar.add(body, head, feet);
    avatar.visible = false;
    threeScene.add(avatar);
    avatarRef.current = avatar;

    personRingsRef.current = [];
    for (let i = 0; i < 3; i++) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.14, 0.18, 48),
        new THREE.MeshBasicMaterial({
          color: THEME.green,
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
      new THREE.LineBasicMaterial({ color: THEME.green, transparent: true, opacity: 0.35 })
    );
    threeScene.add(trail);
    trailRef.current = trail;

    function acquireShell(): Shell | null {
      let s = shellsRef.current.find((x) => !x.active);
      if (!s) {
        if (shellsRef.current.length >= 6) return null;
        const mesh = new THREE.Mesh(
          shellGeo.current!,
          new THREE.MeshBasicMaterial({
            color: THEME.orange,
            wireframe: true,
            transparent: true,
            opacity: 0,
            depthWrite: false,
          })
        );
        threeScene.add(mesh);
        s = { mesh, t: 0, life: 1.3, maxR: 1.1, active: false };
        shellsRef.current.push(s);
      }
      return s;
    }

    function resize() {
      const host = mountRef.current;
      if (!host) return;
      const w = host.clientWidth;
      const h = host.clientHeight;
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
        labelAcc.current += dt;
        fieldAcc.current += dt;
        const doLabels = labelAcc.current > 0.12;
        if (doLabels) labelAcc.current = 0;
        const doField = fieldAcc.current > 0.2;
        if (doField) fieldAcc.current = 0;

        // Boards
        boardsRef.current.forEach((bv, i) => {
          const node = snap.nodes.find((n) => n.board_id === bv.boardId);
          const online = node?.connection === "online";
          const live = linkForBoard(snap, bv.boardId);
          (bv.led.material as THREE.MeshBasicMaterial).color.setHex(
            online ? THEME.green : THEME.muted
          );
          const hot =
            live?.motion_score != null &&
            live.motion_threshold != null &&
            live.motion_score > live.motion_threshold;
          bv.led.scale.setScalar(0.9 + 0.25 * Math.sin(t * (hot ? 6.5 : 2) + i));
          bv.boardMat.emissiveIntensity = online ? (hot ? 0.28 : 0.12) : 0.03;
          bv.labelSprite.position.y = 0.32 + Math.sin(t * 0.7 + i) * 0.01;
          if (doLabels) {
            drawLabel(bv.labelCtx, bv.labelTex, bv.boardId, bv.role, live, !!online);
          }
        });

        // Link tubes from real scores
        snap.links.forEach((l) => {
          const mat = linkMats.current[l.link_id];
          if (!mat) return;
          if (l.quality === "unavailable" || l.rssi_dbm == null) {
            mat.opacity = 0.05;
            mat.color.setHex(THEME.muted);
            return;
          }
          const hot =
            l.motion_score != null &&
            l.motion_threshold != null &&
            l.motion_score > l.motion_threshold;
          mat.opacity = hot
            ? 0.7
            : 0.16 + Math.min(0.28, (l.presence_score ?? 0) * 0.08);
          mat.color.setHex(hot ? THEME.green : THEME.orangeSoft);
        });

        // Floor signal field — damp quiet rooms so motion is the pop
        if (doField && fieldColors.current && fieldRef.current && fieldMeta.current) {
          const grid = computeFieldGrid(layout, snap.links, fieldMeta.current.nx, fieldMeta.current.ny);
          const col = tmpColor.current;
          const colors = fieldColors.current;
          const positions = fieldPos.current!;
          for (let i = 0; i < grid.values.length; i++) {
            const raw = grid.values[i];
            const s =
              raw < 0.35 ? raw * 0.45 : Math.min(1.55, 0.16 + (raw - 0.35) * 1.65);
            scoreToColor(s, col);
            colors[i * 3] = col.r;
            colors[i * 3 + 1] = col.g;
            colors[i * 3 + 2] = col.b;
            positions[i * 3 + 1] = 0.03 + Math.min(0.42, s * 0.28);
          }
          fieldRef.current.geometry.attributes.color.needsUpdate = true;
          fieldRef.current.geometry.attributes.position.needsUpdate = true;
        }

        // Shells: quiet heartbeat on TX; lively only when motion crosses threshold
        spawnAcc.current += dt;
        const txLive = snap.links.some((l) => l.rssi_dbm != null);
        const anyHot = snap.links.some(
          (l) =>
            l.motion_score != null &&
            l.motion_threshold != null &&
            l.motion_score > l.motion_threshold
        );
        if (txLive && spawnAcc.current >= (anyHot ? 0.42 : 1.35)) {
          spawnAcc.current = 0;
          const b1 = boardsRef.current.find((b) => b.boardId === "b1");
          if (b1) {
            const shell = acquireShell();
            if (shell) {
              const live = linkForBoard(snap, "b1");
              const activity = live?.motion_score
                ? Math.min(1.4, live.motion_score / Math.max(live.motion_threshold ?? 0.8, 0.1))
                : 0.35;
              shell.active = true;
              shell.t = 0;
              shell.life = anyHot ? 1.15 + activity * 0.35 : 1.4;
              shell.maxR = anyHot ? 0.85 + activity * 0.9 : 0.55;
              shell.mesh.position.copy(b1.worldPos);
              shell.mesh.scale.setScalar(0.06);
              shell.mesh.visible = true;
              const mat = shell.mesh.material as THREE.MeshBasicMaterial;
              mat.color.setHex(anyHot ? THEME.green : THEME.orange);
              mat.opacity = anyHot ? 0.22 : 0.1;
            }
          }
          if (anyHot) {
            boardsRef.current
              .filter((b) => b.boardId !== "b1")
              .forEach((bv) => {
                const live = linkForBoard(snap, bv.boardId);
                if (!live || live.rssi_dbm == null) return;
                if ((live.motion_score ?? 0) < (live.motion_threshold ?? 0.8) * 0.55)
                  return;
                const shell = acquireShell();
                if (!shell) return;
                const activity = Math.min(
                  1.3,
                  (live.motion_score ?? 0.3) / Math.max(live.motion_threshold ?? 0.8, 0.1)
                );
                shell.active = true;
                shell.t = 0;
                shell.life = 0.95 + activity * 0.3;
                shell.maxR = 0.45 + activity * 0.55;
                shell.mesh.position.copy(bv.worldPos);
                shell.mesh.scale.setScalar(0.05);
                shell.mesh.visible = true;
                const mat = shell.mesh.material as THREE.MeshBasicMaterial;
                mat.color.setHex(activity > 1 ? THEME.green : THEME.orange);
                mat.opacity = 0.18;
              });
          }
        }

        const track = snap.tracks[0];
        const motionMax = Math.max(0, ...snap.links.map((l) => l.motion_score ?? 0));
        const motionTh = Math.max(
          0.01,
          ...snap.links.map((l) => l.motion_threshold ?? 0.8)
        );
        const bounce = Math.min(1.6, motionMax / motionTh);

        if (track && avatarRef.current) {
          avatarRef.current.visible = true;
          const p = toThree(track.position.x_m, track.position.y_m, 0);
          avatarRef.current.position.lerp(p, 0.22);
          if (track.heading_rad != null) {
            avatarRef.current.rotation.y = -track.heading_rad + Math.PI / 2;
          }
          // Soft walk bob from motion score
          avatarRef.current.position.y = Math.sin(t * (4 + bounce * 3)) * 0.012 * bounce;
          trailPts.current.push(p.clone().setY(0.04));
          if (trailPts.current.length > 48) trailPts.current.shift();
          trailRef.current!.geometry.setFromPoints(trailPts.current);

          personRingsRef.current.forEach((ring, i) => {
            ring.visible = true;
            const phase = (t * (0.55 + bounce * 0.45) + i * 0.55) % 1.5;
            ring.position.set(p.x, 0.028, p.z);
            ring.scale.setScalar(0.35 + phase * (1.05 + bounce * 0.25));
            (ring.material as THREE.MeshBasicMaterial).opacity =
              0.35 * (1 - phase / 1.5) * Math.min(1, 0.3 + bounce * 0.45);
          });
        } else if (avatarRef.current) {
          avatarRef.current.visible = false;
          avatarRef.current.position.y = 0;
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
        s.mesh.scale.setScalar(0.06 + k * s.maxR);
        const startOp = s.maxR > 0.7 ? 0.22 : 0.1;
        (s.mesh.material as THREE.MeshBasicMaterial).opacity = startOp * (1 - k);
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
