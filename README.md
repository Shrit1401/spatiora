# Spatiora

Standalone Next.js console for three-ESP Wi-Fi sensing — 3D room twin, presence, and link diagnostics.

**Milestone 1:** simulation + dummy `/api/v1/*` routes. No firmware changes.

## Run

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Mock API

| Path | Purpose |
| --- | --- |
| `GET /api/v1/health` | Service health |
| `GET /api/v1/rooms/{room}/layout` | Board triangle layout |
| `GET /api/v1/rooms/{room}/sessions/{session}/capabilities` | Feature flags |
| `GET /api/v1/rooms/{room}/sessions/{session}/scene` | Canonical scene snapshot |
| `GET /api/v1/rooms/{room}/sessions/{session}/signals?link_id=` | RSSI / score history |
| `GET /api/v1/rooms/{room}/sessions/{session}/csi-window` | Small CSI matrix |
| `POST /api/v1/simulations` | Create / reseed sim |
| `PATCH /api/v1/simulations/{id}` | pause / resume / reset / speed / scenario |

If a fetch fails, the client falls back to an in-browser simulator (same shapes).

## Hook a real backend later

```env
NEXT_PUBLIC_API_BASE=https://your-api.example
NEXT_PUBLIC_ROOM_ID=room-1
NEXT_PUBLIC_SESSION_ID=live-1
```

Keep the same JSON contract; the UI already treats `null` and unavailable capabilities honestly.
