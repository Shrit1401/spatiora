"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { RoomLayout, SceneSnapshot } from "@/lib/types";

/** room_local_z_up → Three.js Y-up: (x, y, z) → (x, z, -y) */
function toThree(x: number, y: number, z: number): THREE.Vector3 {
  return new THREE.Vector3(x, z, -y);
}

type Props = {
  layout: RoomLayout;
  scene: SceneSnapshot | null;
};

export default function RoomScene({ layout, scene }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<SceneSnapshot | null>(null);
  const avatarRef = useRef<THREE.Group | null>(null);
  const trailRef = useRef<THREE.Line | null>(null);
  const trailPts = useRef<THREE.Vector3[]>([]);
  const linkMats = useRef<Record<string, THREE.LineBasicMaterial>>({});
  const nodeLeds = useRef<Record<string, THREE.Mesh>>({});

  useEffect(() => {
    sceneRef.current = scene;
  }, [scene]);

  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
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

    threeScene.add(new THREE.AmbientLight(0xb8c0cc, 0.6));
    const key = new THREE.DirectionalLight(0xffffff, 0.8);
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

    const grid = new THREE.GridHelper(Math.max(fw, fd), 10, 0x2e3644, 0x222833);
    grid.position.copy(floor.position);
    threeScene.add(grid);

    // Triangle outline (geometry only — not a measured link)
    const poly = layout.monitored_polygon_xy;
    const triPts = [...poly, poly[0]].map(([x, y]) => toThree(x, y, 0.02));
    threeScene.add(
      new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(triPts),
        new THREE.LineBasicMaterial({ color: 0x6a7588, transparent: true, opacity: 0.7 })
      )
    );

    // Boards
    layout.boards.forEach((b) => {
      const [x, y, z] = b.position_m;
      const g = new THREE.Group();
      g.position.copy(toThree(x, y, z));

      const board = new THREE.Mesh(
        new THREE.BoxGeometry(0.12, 0.28, 0.06),
        new THREE.MeshStandardMaterial({
          color: 0x1a2230,
          emissive: 0x5b9fd4,
          emissiveIntensity: 0.2,
          metalness: 0.3,
          roughness: 0.5,
        })
      );
      g.add(board);

      const led = new THREE.Mesh(
        new THREE.SphereGeometry(0.03, 10, 8),
        new THREE.MeshBasicMaterial({ color: 0x5b9fd4 })
      );
      led.position.y = 0.18;
      g.add(led);
      nodeLeds.current[b.board_id] = led;

      const cv = document.createElement("canvas");
      cv.width = 128;
      cv.height = 32;
      const ctx = cv.getContext("2d")!;
      ctx.fillStyle = "rgba(17,19,24,0.9)";
      ctx.fillRect(0, 0, 128, 32);
      ctx.fillStyle = "#d0d8e4";
      ctx.font = "bold 16px system-ui,sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(b.board_id.toUpperCase(), 64, 22);
      const spr = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), depthTest: false })
      );
      spr.scale.set(0.55, 0.14, 1);
      spr.position.y = 0.35;
      g.add(spr);

      // Drop line to floor
      threeScene.add(
        new THREE.Line(
          new THREE.BufferGeometry().setFromPoints([
            toThree(x, y, 0),
            toThree(x, y, z),
          ]),
          new THREE.LineDashedMaterial({
            color: 0x4a5568,
            dashSize: 0.08,
            gapSize: 0.05,
            transparent: true,
            opacity: 0.5,
          })
        )
      );

      threeScene.add(g);
    });

    // Sensing links (only enabled measured edges)
    layout.sensing_links
      .filter((l) => l.enabled)
      .forEach((link) => {
        const tx = layout.boards.find((b) => b.board_id === link.tx_board_id)!;
        const rx = layout.boards.find((b) => b.board_id === link.rx_board_id)!;
        const mat = new THREE.LineBasicMaterial({
          color: 0x5b9fd4,
          transparent: true,
          opacity: 0.55,
        });
        linkMats.current[link.link_id] = mat;
        const line = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints([
            toThree(...tx.position_m),
            toThree(...rx.position_m),
          ]),
          mat
        );
        threeScene.add(line);
      });

    // Avatar
    const avatar = new THREE.Group();
    const skin = new THREE.MeshStandardMaterial({
      color: 0x3ecf8e,
      emissive: 0x1a5c3d,
      emissiveIntensity: 0.25,
      transparent: true,
      opacity: 0.92,
    });
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.55, 12), skin);
    torso.position.y = 1.05;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 10), skin);
    head.position.y = 1.45;
    const legs = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.7, 10), skin);
    legs.position.y = 0.4;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.22, 0.28, 36),
      new THREE.MeshBasicMaterial({
        color: 0x3ecf8e,
        transparent: true,
        opacity: 0.7,
        side: THREE.DoubleSide,
      })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.03;
    avatar.add(torso, head, legs, ring);
    avatar.visible = false;
    threeScene.add(avatar);
    avatarRef.current = avatar;

    const trailGeo = new THREE.BufferGeometry();
    const trail = new THREE.Line(
      trailGeo,
      new THREE.LineBasicMaterial({ color: 0x3ecf8e, transparent: true, opacity: 0.45 })
    );
    threeScene.add(trail);
    trailRef.current = trail;

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
      const t = clock.getElapsedTime();
      const snap = sceneRef.current;

      Object.values(nodeLeds.current).forEach((led, i) => {
        led.scale.setScalar(0.85 + 0.25 * Math.sin(t * 3 + i));
      });

      if (snap) {
        snap.nodes.forEach((n) => {
          const led = nodeLeds.current[n.board_id];
          if (!led) return;
          const mat = led.material as THREE.MeshBasicMaterial;
          mat.color.setHex(n.connection === "online" ? 0x3ecf8e : 0x6b7280);
        });
        snap.links.forEach((l) => {
          const mat = linkMats.current[l.link_id];
          if (!mat) return;
          if (l.quality === "unavailable" || l.rssi_dbm == null) {
            mat.opacity = 0.12;
            mat.color.setHex(0x6b7280);
          } else {
            const hot = (l.motion_score ?? 0) > (l.motion_threshold ?? 0.8);
            mat.opacity = hot ? 0.85 : 0.45;
            mat.color.setHex(hot ? 0x3ecf8e : 0x5b9fd4);
          }
        });

        const track = snap.tracks[0];
        if (track && avatarRef.current) {
          avatarRef.current.visible = true;
          const p = toThree(track.position.x_m, track.position.y_m, 0);
          avatarRef.current.position.lerp(p, 0.25);
          if (track.heading_rad != null) {
            // heading around +z in room → around +y in three after conversion
            avatarRef.current.rotation.y = -track.heading_rad + Math.PI / 2;
          }
          trailPts.current.push(p.clone());
          if (trailPts.current.length > 80) trailPts.current.shift();
          trailRef.current!.geometry.setFromPoints(trailPts.current);
        } else if (avatarRef.current) {
          avatarRef.current.visible = false;
          trailPts.current = [];
          trailRef.current!.geometry.setFromPoints([]);
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
      if (renderer.domElement.parentElement === el) el.removeChild(renderer.domElement);
    };
  }, [layout]);

  return <div ref={mountRef} className="absolute inset-0" />;
}
