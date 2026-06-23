# Database Table Reference

Documentation for the six core tables (five geographic/redistricting + submissions). These are **planned** tables — only `profiles` exists in Supabase today; the map still uses JSON files for most geographic data.

---

## 1. `dissemination_areas`

### What Data It Holds
One row per **Dissemination Area (DA)** — the smallest census geography used for redistricting. Stores **attributes** (population, names, province), not polygon geometry (that stays in GPKG/GeoJSON files for now).

### What It’s Used For
* **Map Clicks:** Show DA details when a user clicks the map (population, community, DGUID).
* **Validation:** Sum population per district when validating a proposed map.
* **Joins:** Target for `da_assignments` and optional link from `submissions`.

### Columns

| Column | Type | What It Stores |
| :--- | :--- | :--- |
| `dguid` `(PK)` | TEXT | Statistics Canada unique ID for this DA (e.g., `2021S051260010118`). Main join key to map GeoJSON and profile data. |
| `dauid` | TEXT | Shorter DA code (e.g., `60010118`). From GPKG `DAUID` or profile `da_code`. |
| `province_code` | CHAR(2) | Province/territory code (e.g., `YT`, `AB`). From GPKG `PRUID` or known from import source. |
| `geo_name` | TEXT | Official census geography name. From StatCan profile CSV `GEO_NAME` or profile JSON. Not on GPKG polygons. |
| `population` | INTEGER | 2021 census total population (`CHARACTERISTIC_ID = 1`). From profile JSON or CSV `C1_COUNT_TOTAL`. |
| `community_name` | TEXT | Census subdivision (CSD) name at the DA’s location (e.g., `Old Crow`). From spatial lookup, not in GPKG. |
| `is_unorganized` | BOOLEAN | `TRUE` if the DA lies in an “Unorganized” CSD (common in Yukon). Affects map panel titles. |
| `land_area` | DOUBLE PRECISION | Land area of the DA polygon. From GPKG `LANDAREA`. |
| `status` | TEXT | Data quality flag: `ok`, `missing`, or `partial`. |
| `source_label` | TEXT | Human-readable citation for population data. |
| `source_url` | TEXT | URL to the StatCan product used for population. |
| `created_at` | TIMESTAMPTZ | When this row was inserted (DB-only, not from StatCan). |

> 🛠️ **Fill now:** Yukon only (74 rows) from `yt_da_profiles.json`.

---

## 2. `fed_districts`

### What Data It Holds
One row per **federal electoral district (riding / FED)** — 343 ridings for the 2023 Representation Order.

### What It’s Used For
* Resolve `fed_num` $\rightarrow$ riding name for map labels and panels.
* Reference when assignments use official `fed_num` as `district_id`.
* Link `submissions` to the riding a user commented on.

### Columns

| Column | Type | What It Stores |
| :--- | :--- | :--- |
| `fed_num` `(PK)` | TEXT | Federal riding ID (e.g., `60001` = Yukon). Same as PMTiles `fed_num`. |
| `name_en` | TEXT | English riding name (e.g., `Yukon`). From `fed_names_2023.json`. |
| `rep_order` | SMALLINT | Boundary version: `2003`, `2013`, or `2023`. Default `2023`. |
| `province_code` | CHAR(2) | Province/territory the riding belongs to (optional, useful for filtering). |

> 🛠️ **Fill now:** All 343 rows from `scripts/data/fed_names_2023.json`. Geometry stays in PMTiles, not this table.

---

## 3. `map_proposals`

### What Data It Holds
One row per **map version** — either the official baseline boundaries or a user’s draft / submitted counter-proposal.

### What It’s Used For
* Separate official 2023 map from user redraws without overwriting baseline data.
* Group `da_assignments` under one coherent proposal.
* Link counter-proposal submissions to the map a user drew.

### Columns

| Column | Type | What It Stores |
| :--- | :--- | :--- |
| `id` `(PK)` | UUID | Unique ID for this proposal. Referenced by `da_assignments.proposal_id` and `submissions.proposal_id`. |
| `user_id` `(FK)` | UUID | Who created it. `NULL` for system-seeded baseline. References `auth.users`. |
| `title` | TEXT | Display name (e.g., `Official 2023 — Yukon`, `John’s counter-proposal #1`). |
| `province_code` | CHAR(2) | Province/territory this proposal applies to (e.g., `YT`). |
| `status` | TEXT | Workflow state: `draft`, `submitted`, `under_review`, `approved`, `rejected`, etc. |
| `is_baseline` | BOOLEAN | `TRUE` = official current boundaries (one per province). `FALSE` = user-created. |
| `created_at` | TIMESTAMPTZ | When the proposal was created. |
| `updated_at` | TIMESTAMPTZ | Last time assignments under this proposal changed. |

> 🛠️ **Fill now:** 1 baseline row for Yukon (`is_baseline = TRUE`).

---

## 4. `da_assignments`

### What Data It Holds
The **core redistricting table**: tracks which DA belongs to which district for a given proposal. One row = one DA assigned to one district. Whole DAs only — never split.

### What It’s Used For
* Define the current electoral map (baseline) or a proposed new map.
* Drive map coloring by district (future).
* Compute district population by summing `dissemination_areas.population` per `district_id`.
* Dynamically updated by the app when users redistrict.

### Columns

| Column | Type | What It Stores |
| :--- | :--- | :--- |
| `proposal_id` `(FK)` | UUID | Which map version. Points to `map_proposals.id`. |
| `dguid` `(FK)` | TEXT | Which DA. Points to `dissemination_areas.dguid`. |
| `district_id` | TEXT | Which district this DA belongs to. Baseline: often official `fed_num` (e.g., `60001`). Redraws: proposal-local IDs (`1`, `2`, `3`) for new districts. |

* **Primary Key:** `(proposal_id, dguid)` — each DA appears once per proposal.

> 🛠️ **Fill now:** 74 Yukon rows, all `district_id = '60001'`, under the baseline `map_proposals` row.

---

## 5. `da_adjacency`

### What Data It Holds
Which DAs **share a border** (touching polygons). Stored as unordered pairs within a province.

### What It’s Used For
**Validation Backend (Not built yet):**
* Ensure every district is **contiguous** (one connected blob of DAs).
* Check that moved DAs stay connected to their new district.
* Support algorithms that swap neighboring DAs.

### Columns

| Column | Type | What It Stores |
| :--- | :--- | :--- |
| `province_code` | CHAR(2) | Province scope. Adjacency is computed per province GPKG. |
| `dguid_a` `(FK)` | TEXT | First DA in the pair (lexicographically smaller `DGUID`). |
| `dguid_b` `(FK)` | TEXT | Second DA — neighbor of `dguid_a`. |

* **Primary Key:** `(province_code, dguid_a, dguid_b)` where `dguid_a < dguid_b`.

> 🛠️ **Fill now:** Optional. Build from `yt_dissemination_areas.gpkg` via spatial “touches” script. Not in the bundle as a ready-made file.

---

## 6. `submissions`

### What Data It Holds
One row per **citizen feedback or counter-proposal** — comments on boundaries, complaints about a specific DA or riding, or a submitted redraw linked to a `map_proposals` row.

### What It’s Used For
* **Public User Flow:** Click map $\rightarrow$ write comment $\rightarrow$ submit.
* **Commissioner Dashboard:** Review, approve/reject, filter by status or riding.
* **Geographic Context:** Tie feedback directly to a riding (`fed_num`), a specific DA (`dguid`), or an optional counter-proposal map.

### Columns

| Column | Type | What It Stores |
| :--- | :--- | :--- |
| `id` `(PK)` | UUID | Unique submission ID. |
| `user_id` `(FK)` | UUID | Who submitted. References `auth.users`. `NULL` if anonymous flow is added later. |
| `type` | TEXT | `feedback` (comment only) or `counter_proposal` (includes a redrawn map). |
| `proposal_id` `(FK)` | UUID | Link to `map_proposals` if submission includes a user-drawn map. `NULL` for simple feedback. |
| `fed_num` `(FK)` | TEXT | Riding the user clicked or commented on. References `fed_districts.fed_num`. |
| `dguid` `(FK)` | TEXT | Specific DA clicked. References `dissemination_areas.dguid`. |
| `title` | TEXT | Short summary shown in submission lists (e.g., *District boundary correction request*). |
| `comment` | TEXT | Full feedback body text. |
| `status` | TEXT | Commissioner workflow: `pending`, `under_review`, `approved`, `rejected`. Default `pending`. |
| `created_at` | TIMESTAMPTZ | When submitted. |
| `updated_at` | TIMESTAMPTZ | Last status or content change. |

> 🛠️ **Fill now:** No — UI uses mock data in `MySubmissions.jsx`. Create the table structure now; seed data later when the submission feature is fully wired up.

---

## How the Tables Relate

```text
auth.users
    │
    ├──► map_proposals (id, is_baseline, province_code)
    │         │
    │         ├──► da_assignments (proposal_id, dguid, district_id)
    │         │         │
    │         │         └──► dissemination_areas (dguid, population, …)
    │         │
    │         └──► submissions (proposal_id)   ← counter-proposals
    │
    └──► submissions (user_id)

fed_districts (fed_num, name_en)
    ▲
    │  district_id may equal fed_num
    │  submissions.fed_num
    │
da_assignments (proposal_id, dguid, district_id)

dissemination_areas (dguid, …)
    ▲
    │  submissions.dguid (optional)

da_adjacency (dguid_a, dguid_b)  ──► validation only
