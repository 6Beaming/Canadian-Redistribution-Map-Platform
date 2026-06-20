# Demo 1 Log — Map MVP React Integration

**Sprint:** Map rendering MVP merged into team frontend  
**Branch:** `feature/map-mvp-and-frontend-merging`  
**Date:** 2026-06-17  
**Status:** Delivered — map module embedded on `/dashboard`

---

## 1. Sprint objective

Replace the standalone `map-mvp/` vanilla-JS prototype with React components inside the shared Vite app, backed by a decoupled Express **map-api-service**. The map module is temporarily hosted on the commissioner dashboard shell (`/dashboard`) until Public User and Commissioner layouts are fully split.


---

## 2. Delivered map module (Updated by Erfang with Merged feature/issues6-8/map-rendering-mvp)

### 2.1 UI components (`src/components/non_prebuilt/`)

| Component | Replaces | Role |
|-----------|----------|------|
| **MapCanvas** | `map-mvp/js/map.js` + label layer setup | MapLibre GL map: 343 FED base, Yukon 74 DAs, four label layers, fullscreen control, click/hover |
| **MapInfoPanel** | `map-mvp/js/panel.js` | Right sidebar: DA census details or FED “Coming Soon!” |

**Layout on `/dashboard`:**

- Left **75%** viewport width (`grid-template-columns: 3fr 1fr`): top spacer + **MapCanvas** occupying bottom **2/3** viewport height.
- Right **25%** viewport width: **MapInfoPanel** full viewport height.
- **Fullscreen mode:** map control (below zoom) or **Esc** expands map to full viewport; layout stays **75% / 25%**; map frame border removed while fullscreen.
- Styles in `src/styles/map.css` only — no inline layout on the page.

### 2.2 Client services & libs

| Path | Role |
|------|------|
| `src/services/mapApi.js` | All map data access via `/api/map/*`; `absoluteAssetUrl()` for PMTiles protocol |
| `src/lib/map/constants.js` | Colours, zoom thresholds, MVP FED `60001` |
| `src/lib/map/profileUtils.js` | DA profile titles, labels, population helpers |
| `src/lib/map/labelLayout.js` | Four label layers (2 FED + 2 DA), zoom curves, collision rules, responsive scale |

### 2.3 Local data (`src/data/map/`)

| File | Role |
|------|------|
| `fed_boundaries_2023.pmtiles` | National FED vector tiles (byte-range required) |
| `fed_boundaries_2023.geojson` | FED fallback when PMTiles unavailable |
| `single_fed_das.geojson` | Yukon DA polygons (`DGUID`) |
| `fed_labels.geojson` | 343 FED name labels |
| `yt_da_profiles.json` | 74/74 DA profiles (population, community, panel titles) |

Data collection scripts under `scripts/` are **unchanged**; they may still write to legacy paths until updated in a later sprint.

### 2.4 map-api-service (`server/map-api-service/`)

Standalone module mounted from `server/app.js` only.

| Endpoint | Purpose |
|----------|---------|
| `GET /api/map/assets/:file` | GeoJSON / PMTiles with **Accept-Ranges** (206 for PMTiles probe) |
| `GET /api/map/da-profiles` | Yukon DA profile JSON |
| `GET /api/map/assignments` | Assignment table (replaces browser `localStorage`) |
| `PUT /api/map/assignments` | Persist assignment table server-side |

Store file: `server/map-api-service/store/assignments.json` (gitignored).

### 2.5 Runtime behaviour

| Interaction | Result |
|-------------|--------|
| National view | 343 FED polygons (PMTiles preferred; GeoJSON fallback) |
| FED labels — national | `fed-labels-national`: zoom **3–9**, capped size; fades by zoom 8.5 |
| FED labels — local | `fed-labels-local`: zoom **9+** (through map max zoom **14**), small labels so names remain visible when zoomed in |
| Yukon DA polygons | 74 DAs; outlines visible from zoom **≥ 9** |
| DA labels — community | `da-labels-community`: zoom **≥ 6**; collision-aware until zoom 11 |
| DA labels — code | `da-labels-code`: zoom **≥ 10**; numeric DA codes, smaller font |
| Label scaling | `text-size` scales with map container width (`labelScreenScale`) |
| DA click | Yellow highlight + panel (population, community, DGUID, sources) |
| Non-pilot FED click | Panel: riding name + **Coming Soon!** |
| Fullscreen | Map control below zoom; **Esc** exits; body scroll locked |
| Dev stack | Single `npm run dev` — Vite (default `:5173`, next free port if busy) proxies `/api` → Express `:3000` |

### 2.6 Removed artifacts

- Entire `map-mvp/` directory
- `server/serve-map-mvp.js`
- `npm run dev:map` script

### 2.7 Conclusion

1. Map MVP is **production-ready as a React module** with API-backed data — no separate static server.
2. PMTiles byte-range is preserved through `map-api-service` asset routes (`absoluteAssetUrl` for MapLibre protocol).
3. Assignment persistence moved from `localStorage` to server API (UI wiring for redistricting clicks still deferred).
4. Adaptive label layers reduce stacking in dense DA areas and keep FED names visible at high zoom.
5. Next integration step: extract shared map module for Public User route once that app shell exists.

---

## 3. Brief project architecture (other team work)

| Layer | Stack | Current state |
|-------|-------|---------------|
| **Frontend** | React 19, Vite, Tailwind 4, shadcn/ui (`src/components/ui`) | Auth page at `/`; commissioner graphs at `/dashboard/graphs` (mock data) |
| **Backend** | Express ESM, Supabase auth routes (`/api/auth/*`) | Auth incomplete — waiting for merging |
| **Database** | Supabase (PostgreSQL) | Planned; not wired to map module |
| **Data tooling** | `scripts/` Python notebooks & collectors | Bundle audit, Yukon profile pipeline, FED labels |

**Component convention:** `src/components/ui` = shadcn prebuilt; `src/components/non_prebuilt` = team-built (map, submission graphs).

**Two product surfaces (as planned):** Public User (map + view + submission) and Commissioner (dashboard + map + analytics). Public User surface is not yet on `main`; map module currently lives on `/dashboard` as integration staging.

**![#ff0000](https://placehold.co/15x15/ff0000/ff0000.png) Important: Waiting for merging of completed auth feature and frontends for Public User and Commissioner.**

---

## 5. Document history

| Date | Change |
|------|--------|
| 2026-06-17 | Initial Demo 1 log; React refactor delivered on `/dashboard` |
| 2026-06-17 | Layout 75/25; four label layers; fullscreen; PMTiles `absoluteAssetUrl` |
