# Future Counter-Proposal Geometry Scalability Plan

## 1. Status and purpose

This document records the post-course plan for eliminating browser out-of-memory failures when a Counter-Proposal targets a highly fragmented or extremely detailed dissemination-area (DA) pair.

The plan is intentionally not an implementation commitment for the current delivery. It freezes the architectural direction, proposed data contracts, implementation order, and acceptance criteria so that a future refactor does not attempt another handle-density-only optimization.

The required outcome is:

- every eligible adjacent DA pair can be inspected without loading exact pair geometry into the browser;
- ordinary and extreme coastal pairs use the same edit semantics;
- the browser renders a compact display representation and edits stable shared-arc vertices;
- the server remains authoritative and validates sparse operations against the immutable exact release;
- the existing PMTiles basemap remains independent and does not need to be rebuilt for this work;
- release artifacts remain immutable, local, versioned data under `src/data/map/releases/<releaseId>/`, not browser-generated data and not transient Supabase cache rows.

## 2. Audit findings

### 2.1 Measured release payloads

The audit used release `statscan-da-2021-r1` and distinguished handle count from total polygon complexity.

| Area and representative pair | Pair vertices | Rings | Approximate API payload | Approximate expanded peak | Observed build characteristic |
| --- | ---: | ---: | ---: | ---: | --- |
| Saanich—Gulf Islands: `170642 + 170644` | 13,024 | 49 | 0.51 MB | about 10 MB | about 79 ms |
| Saanich—Gulf Islands: `170642 + 170643` | 11,674 | 124 | 0.46 MB | about 9 MB | about 123 ms |
| Sunshine Coast: `290097 + 290098` | 25,864 | 9 | 4.79 MB including outer-boundary expansion | about 20 MB | moderate pressure |
| North Island—Powell River outlier: `450027 + 490179` | 711,985 | thousands | 27.2 MB exact pair; 131.8 MB outer boundary | about 534 MB before MapLibre/GPU overhead | about 71 seconds to build the current cache |

The most complex single audited DA, `2021S051259450027`, contains approximately 395,065 vertices and 4,756 rings. The worst audited pair has only 226 fine-LOD handles. Reducing `maxHandles` therefore cannot materially reduce the exact feature payload, `edgeOwners`, outer-boundary expansion, structured clones, or MapLibre triangulation work.

### 2.2 Current release behavior

The release builder currently produces stable vertices and fine/medium/coarse LODs only for shared pair arcs:

- `scripts/reusable/build_map_release.py` defines the three LOD tolerances;
- its topology pass groups shared edges into stable arc chains;
- `server/lib/map/canonicalReleaseStore.js` chooses the first shared-arc LOD whose handle count is within the requested limit.

This mechanism works for controlling editable handles. It does not control the number of coordinates in either complete DA polygon.

The current `representation=edit` response still returns both exact DA features together with the compact shared-boundary data. The browser then:

1. normalizes the exact features;
2. clones them into original and current states;
3. builds a full `buildDaObjectionIndex()` and `edgeOwners` map;
4. derives the pair outer boundary by traversing the full index;
5. creates additional FeatureCollections for MapLibre;
6. structured-clones the cache into a Worker;
7. returns a complete cache from Worker commit, undo, and redo operations.

Important implementation locations are:

- `server/lib/map/canonicalReleaseStore.js` — exact pair read and LOD selection;
- `src/lib/map/releasePairLoader.js` — edit-pair request and browser cache construction;
- `src/lib/map/counterProposalWorkflow.js` — full feature cloning, pair-index rebuilds, impact calculation, and history;
- `src/lib/map/objectionWorkflow.js` — `edgeOwners`, adjacency, shared-boundary, and outer-boundary derivation;
- `src/services/counterProposalWorkerClient.js` — full-cache Worker initialization;
- `src/lib/map/counterProposalWorkerDomain.js` — full-cache commit/undo/redo responses;
- `src/components/non_prebuilt/MapCanvas.jsx` — GeoJSON sources, fills, outlines, and editable-handle presentation.

### 2.3 Root cause

The failure is a representation problem, not a handle-density problem.

Nested GeoJSON coordinates are expensive JavaScript objects. The current path holds several logically equivalent versions of the pair at once, builds hundreds of thousands of string-keyed edge records, clones the cache across execution contexts, and sends highly fragmented polygons through MapLibre's fill pipeline. The raw JSON byte count therefore substantially understates the peak memory footprint.

MapLibre's GeoJSON `tolerance` can simplify the internal tiled rendering representation, but the original GeoJSON must still enter the source/worker pipeline. It cannot remove the initial exact payload, application-side clones, or full topology index. `updateData()` may reduce the cost of later feature updates when stable IDs exist, but it does not solve initial exact-geometry ingestion.

References:

- [MapLibre GeoJSON source options](https://maplibre.org/maplibre-style-spec/sources/)
- [MapLibre GeoJSONSource API](https://maplibre.org/maplibre-gl-js/docs/API/classes/GeoJSONSource/)
- [geojson-vt options and simplification behavior](https://github.com/mapbox/geojson-vt)
- [Earcut polygon triangulation behavior](https://github.com/mapbox/earcut)
- [TopoJSON shared topology and topology-preserving simplification](https://github.com/topojson/topojson)

## 3. Architectural decision

### 3.1 Separate exact, edit, and display representations

The future workflow must use three representations with different ownership and lifetimes.

| Representation | Owner | Browser access | Purpose |
| --- | --- | --- | --- |
| Exact immutable geometry | Local canonical release and server | Never during editing | Authoritative operation application, final topology validation, persistence, and archive materialization |
| Compact edit topology bundle | Immutable release and edit API | Yes, for the selected pair only | Handles, stable shared arcs, bounded collision guards, incremental impacts, and sparse history |
| Display overlay | Immutable release and browser map | Yes | Original/proposed shared lines, simplified outline, and compact changed-area visualization |

Exact geometry remains indispensable, but it must leave the browser edit path.

### 3.2 Preserve the existing PMTiles basemap

The PMTiles basemap continues to render the immutable authoritative geography used during normal browsing. This refactor does not require rebuilding PMTiles because the editable overlay is independent.

The preferred Counter-Proposal presentation is:

- PMTiles renders the immutable base DA geography;
- Original mode renders the original shared boundary;
- Proposed mode renders the changed shared boundary and a compact delta polygon between the original and proposed lines;
- a topology-safe simplified outer outline may be drawn when the existing black pair outline is required;
- the browser does not fill or triangulate the two exact DA polygons.

If product requirements continue to require full blue fills for both DAs, those fills must use an offline topology-safe display LOD. They must never use exact edit geometry.

### 3.3 Reuse topology instead of creating one full asset per pair

The release must not duplicate full pair GeoJSON for every adjacent pair. It should store shared topological primitives and small reference indexes:

```text
src/data/map/releases/<releaseId>/
  release.json
  exact/
  topology/
    arc-lods-*.ndjson
    shared-arcs-*.ndjson
    da-arc-refs.json
    pair-shared-arc-refs.json
  edit-bundles/
    manifests-*.ndjson
    guard-segments-*.bin
  indexes/
    vertex-occurrences-*.bin
    pair-complexity.json
```

Each artifact must be content-hashed, declared in `release.json`, and sharded below repository/platform file-size limits. A target shard size of 32–64 MB is preferred; no generated artifact may approach GitHub's 100 MB hard limit.

## 4. Frozen target contracts

### 4.1 Pair complexity record

Every adjacent pair receives a deterministic complexity record during release construction:

```json
{
  "pair": "DA_A|DA_B",
  "exactVertexCount": 711985,
  "ringCount": 4756,
  "sharedExactVertexCount": 226,
  "displayVertexCountByLod": {
    "fine": 12000,
    "medium": 4200,
    "coarse": 1400
  },
  "guardSegmentCount": 3800,
  "estimatedBrowserBytesByLod": {
    "fine": 18000000,
    "medium": 7200000,
    "coarse": 3100000
  },
  "tier": "extreme",
  "editBundleAvailable": true
}
```

Complexity tiers drive display-LOD selection, observability, and temporary gating. They do not weaken server validation.

### 4.2 Edit manifest response

The target edit request returns a manifest and compact artifact references, not two exact features:

```json
{
  "schemaVersion": "1.0",
  "releaseId": "statscan-da-2021-r1",
  "geometryRevision": "sha256:...",
  "topologyRevision": "sha256:...",
  "pair": ["DA_A", "DA_B"],
  "exactDigest": "sha256:...",
  "lod": "medium",
  "complexity": {},
  "display": {
    "arcRefs": [],
    "outerOutlineRefs": [],
    "baseBounds": []
  },
  "edit": {
    "sharedArcRefs": [],
    "handles": [],
    "guardArtifact": {},
    "baseAreas": {},
    "basePopulations": {}
  },
  "constraints": {
    "maximumDisplacementMeters": 0,
    "corridorArtifact": {}
  }
}
```

The exact endpoint remains server-internal. A browser-visible edit request must be rejected if release identity, artifact hashes, or the required compact bundle do not match.

### 4.3 Sparse operation

Counter-Proposal edits use stable, absolute, idempotent operations:

```json
{
  "schemaVersion": "1.0",
  "operationId": "uuid",
  "releaseId": "statscan-da-2021-r1",
  "baseRevision": "sha256:...",
  "pair": ["DA_A", "DA_B"],
  "vertexId": "stable-release-vertex-id",
  "coordinate": [-123.12345678, 49.12345678]
}
```

Relative `dx/dy` commands are not authoritative. The stable vertex ID and absolute coordinate make replay, deduplication, conflict checks, migration, and Archived Tree LWW application deterministic.

### 4.4 Worker protocol

The target Worker owns compact typed-array state. It never receives or returns the full exact or display FeatureCollection.

```text
INIT(transferable edit buffers)
  -> READY(summary)

PREVIEW_MOVE(vertexId, coordinate)
  -> PREVIEW_RESULT(changed arc coordinates, validity, impact delta)

COMMIT_MOVE(vertexId, coordinate)
  -> COMMIT_RESULT(operation, changed arc coordinates, accumulated impact)

UNDO / REDO
  -> COMMIT_RESULT(operation delta, changed arc coordinates, accumulated impact)
```

`ArrayBuffer` ownership should be transferred where practical. `SharedArrayBuffer` is not required for the first implementation because it adds cross-origin-isolation deployment requirements.

### 4.5 Submission contract

The browser submits:

- release and base revision identities;
- canonical pair identity;
- ordered sparse absolute operations;
- non-authoritative preview impact data only when useful for diagnostics.

The server:

1. verifies the active release and exact digest;
2. loads the exact pair without returning it to the browser;
3. resolves every stable vertex occurrence;
4. applies operations to both owners of each shared vertex;
5. runs authoritative topology, clearance, area, and scope validation;
6. calculates authoritative impacts;
7. persists the immutable geometry revision and sparse operations atomically;
8. returns the committed projection and validation summary.

## 5. Release-generation plan

### 5.1 Extend the existing topology pass

The existing SQLite-backed, single-writer topology pass is the correct foundation. Extend it instead of loading all national geometry into memory.

The build should:

1. retain exact shards and current DGUID offsets;
2. construct reusable canonical arcs for both shared and non-shared boundaries;
3. store per-DA ordered arc references and orientation;
4. store pair shared-arc references;
5. assign stable vertex IDs and exact occurrence references;
6. generate topology-safe fine/medium/coarse arc LODs once per arc;
7. derive compact pair outer-outline references without materializing repeated pair GeoJSON;
8. compute pair complexity records;
9. build bounded collision-guard artifacts near editable shared arcs;
10. write hashes, counts, byte sizes, schema versions, and artifact paths to the release manifest.

Adjacent DAs must reuse the same simplified shared arc. Simplifying two polygons independently is prohibited because it can create gaps, overlaps, or inconsistent edit handles.

### 5.2 Preserve significant coastal topology

LOD generation must distinguish editable shared boundaries from non-editable coastlines:

- shared arc endpoints and all editable handle vertices are mandatory at every applicable edit LOD;
- ring closure, winding, and ownership must be preserved;
- islands must not be removed merely because their screen area is small unless the display contract explicitly permits that omission;
- exact geometry and exact validation are never simplified;
- display-only coastlines may use stronger simplification than shared editable arcs;
- every LOD must pass pair union, non-overlap, adjacency, and digest validation.

### 5.3 Generate bounded collision guards

Local validation is only compact if vertex movement is bounded. The edit contract must therefore define a maximum displacement or a server-derived legal movement corridor.

For each editable shared arc, the builder should spatially query only outer/shared segments whose envelopes intersect that corridor. Those segments become the guard artifact used for drag previews. The full exact boundary remains available to the server for commit validation.

If product requirements permit unbounded movement, the client cannot guarantee complete collision validation with a small guard set. In that case, client validation must be explicitly advisory and final submission may be rejected by the server.

## 6. Browser and Worker implementation plan

### 6.1 Pair opening

```text
Select adjacent pair
  -> request compact edit manifest
  -> verify release identity and artifact hashes
  -> load only selected LOD arcs, handles, and guards
  -> transfer edit buffers to Worker
  -> render PMTiles base plus compact overlay
```

Opening Step 3 must not request the two exact DA GeoJSON features. Network tests must enforce this invariant.

Only one Counter-Proposal pair may remain resident. Selecting another pair must abort old requests, remove old MapLibre sources, terminate the old Worker, and release all pair-specific references.

### 6.2 Rendering

Use separate, stable MapLibre sources for:

- original shared line;
- proposed shared line;
- delta fill;
- simplified outer outline;
- handles.

The proposed source should update only changed features. Stable feature IDs may allow `GeoJSONSource.updateData()` for small diffs; otherwise `setData()` is acceptable because the compact overlay is bounded. Exact polygons must never be passed to either method.

### 6.3 Drag preview

During pointer movement:

- throttle or coalesce preview requests to at most one active Worker request per animation frame;
- send only `vertexId + coordinate`;
- reject stale Worker sequence numbers;
- validate affected segments against the compact guard index;
- update only the changed shared arc and delta region;
- never rebuild the complete DA pair index;
- never communicate with Supabase or the submission server.

### 6.4 Incremental area and population

Moving one vertex changes only the shoelace contributions involving that vertex and its immediate neighbors. Store base area plus per-occurrence neighbor references and compute an area delta in constant time per occurrence.

Population change remains derived from the accumulated authoritative area model. The browser result is a preview; the server recalculates it during submission.

### 6.5 History

Undo and redo store bounded sparse operations, not geometry snapshots. Replaying or reversing an operation updates:

- the affected vertex coordinate;
- the affected shared-arc display coordinates;
- local guard validation state;
- accumulated area/population impact.

History limits should be expressed in operation count and compact-buffer bytes.

## 7. Server validation and persistence plan

### 7.1 Avoid rebuilding national-style object graphs

The server may use exact geometry, but it should not repeat the browser's current string-keyed `edgeOwners` expansion on every request.

Use release-built indexes to resolve:

- `vertexId -> exact coordinate occurrences`;
- pair shared arcs;
- nearby collision segments;
- base area and topology identities.

Applying `k` moved vertices should be proportional to their occurrences and affected arcs. Full serialization of the final exact snapshot remains proportional to pair size, but occurs once on the server rather than repeatedly in the browser.

If JavaScript/JSTS validation remains too slow for extreme pairs, evaluate a server-only GEOS/PostGIS validation adapter or a worker-thread validation job. This is an implementation choice; it must not change the frozen browser contract.

### 7.2 Persistence compatibility

The existing immutable submission geometry design remains valid:

- `submission_geometry_revisions` stores committed revision identity and exact result metadata;
- `submission_geometry_operations` stores stable sparse operations;
- the committed exact proposed snapshot may remain available for authorized detail/replay;
- list endpoints remain geometry-free;
- Archived Tree merge applies sparse operations to the latest exact branch snapshot and persists the next immutable version.

The optimization changes how editing data reaches the browser. It does not weaken immutable submission or Archived Tree guarantees.

## 8. Temporary safety gate

Before compact edit bundles are complete, the current exact-browser path must fail safely for pairs predicted to exceed a conservative budget.

The gate should use release-derived data such as:

- exact vertex count;
- ring count;
- outer segment count;
- raw exact bytes;
- estimated expanded browser bytes;
- edit-bundle availability.

An initial policy may classify pairs as standard, complex, or extreme. Exact thresholds must be calibrated from the project test machines and must not be treated as universal browser limits.

If an extreme pair has no validated compact bundle, Step 3 should show a clear unsupported-complexity message instead of attempting to load exact geometry. The gate is a temporary availability limitation, not the final solution.

## 9. Implementation phases

### Phase 0 — Measurement and safety

- Freeze the three-pair regression corpus listed in Section 2.1.
- Record network bytes, pair build duration, Worker copy duration, main-thread long tasks, JS heap, total page/Worker memory, and MapLibre source timing.
- Add pair complexity generation and the temporary hard gate.
- Confirm that repeated open/close cycles release the previous Worker and pair assets.

### Phase 1 — Release topology expansion

- Add reusable all-boundary arcs and per-DA arc references.
- Add vertex occurrence indexes.
- Generate topology-safe display LODs and pair complexity records.
- Generate compact outer-outline and guard artifacts.
- Extend manifest validation and deterministic rebuild tests.

### Phase 2 — Compact API and rendering

- Add the edit-manifest/artifact read contract.
- Stop returning exact features for browser edit requests.
- Render the PMTiles base plus original/proposed lines and delta overlay.
- Preserve the existing black outer and red shared-boundary visual contract using compact artifacts.

### Phase 3 — Worker and local-first editing

- Replace full-cache messages with transferable compact buffers and operation deltas.
- Implement coalesced local preview validation.
- Implement incremental area/population calculation.
- Store sparse operation history only.

### Phase 4 — Authoritative submission

- Accept sparse absolute operations.
- Resolve and apply operations against the immutable exact release.
- Run exact validation and calculate authoritative impacts.
- Persist exact revision output and sparse operations atomically.
- Verify submission detail, Commissioner review, and Archived Tree replay.

### Phase 5 — Remove the legacy exact-browser path

- Delete or permanently reject browser-facing exact edit representation.
- Remove full pair-index and outer-boundary construction from the client workflow.
- Remove full-cache Worker responses.
- Retain a documented rollback to the safe complexity gate, not to an OOM-prone exact fallback.

## 10. Acceptance criteria

### 10.1 Functional

- Every available edit pair uses the active immutable release and stable vertex IDs.
- Original and Proposed views remain visually distinguishable.
- Shared-boundary edits update both DA owners consistently.
- Endpoints and other locked vertices cannot move.
- Undo and redo reproduce the same sparse operation history.
- Client validation is responsive and server validation remains authoritative.
- A rejected server commit preserves the browser draft and returns an actionable reason.
- Reopening a committed Counter-Proposal reproduces its exact persisted result.
- Archived Tree merge/revert continues to use immutable geometry and sparse operations correctly.

### 10.2 Topology

- Every generated LOD preserves pair adjacency and common shared arcs.
- Display LODs contain no gap or overlap between the two selected DAs.
- Exact server results remain valid, non-overlapping, and confined to the legal pair domain.
- LOD generation never changes exact digests or authoritative calculations.

### 10.3 Performance targets

Targets are regression budgets, not universal browser guarantees:

- Step 3 makes no browser request for exact pair GeoJSON.
- A normal pair compact bundle is preferably below 5 MB compressed.
- An extreme pair compact bundle must remain below 15 MB compressed unless a reviewed exception is recorded.
- Opening an extreme pair should add less than 150 MB to total page/Worker memory on the reference test machine.
- Worker initialization should complete within 500 ms after artifacts are available.
- Drag-preview P95 should remain below 50 ms.
- No drag operation should create a main-thread task longer than 100 ms.
- Commit, undo, and redo must not return or retain complete geometry caches.
- Repeatedly opening and closing five pairs must not show monotonic retained-memory growth.

### 10.4 Required regression corpus

At minimum, test:

1. Saanich—Gulf Islands `170642 + 170644`;
2. Saanich—Gulf Islands `170642 + 170643` to stress ring count;
3. Sunshine Coast `290097 + 290098`;
4. North Island—Powell River outlier `450027 + 490179`;
5. an ordinary inland pair;
6. an invalid or unavailable pair;
7. rapid cancellation while switching from the extreme pair to another pair.

For each valid pair, cover open, Original/Proposed switching, handle selection, valid move, invalid move, undo, redo, submit, reconnect, Commissioner review, and archive replay.

## 11. Measurement guidance

Do not use a nominal Chromium or V8 maximum as the acceptance threshold. Actual failure depends on the operating system, renderer/GPU allocations, extensions, other tabs, Worker heaps, garbage-collection timing, and browser version.

Use:

- Chrome DevTools Performance traces for long tasks and source processing;
- allocation sampling and Heap Snapshots before open, after open, and after close;
- browser task-manager process memory for renderer/GPU behavior;
- `performance.measureUserAgentSpecificMemory()` when the required secure and cross-origin-isolated environment is available;
- network traces proving exact geometry is absent.

`performance.memory` is deprecated and can omit Worker or non-JS allocations. Memory comparisons must use the same browser version, machine, route state, and pair.

References:

- [MDN: `measureUserAgentSpecificMemory()`](https://developer.mozilla.org/en-US/docs/Web/API/Performance/measureUserAgentSpecificMemory)
- [MDN: limitations of `performance.memory`](https://developer.mozilla.org/en-US/docs/Web/API/Performance/memory)

## 12. Risks and explicit non-goals

### Risks

- independently simplified polygon boundaries can introduce topology defects;
- unbounded vertex movement can make a compact client collision guard impossible;
- display geometry may look correct while exact server validation rejects the operation;
- careless artifact generation can exceed repository file limits;
- rebuilding complete exact snapshots on the server may remain slow even after browser OOM is eliminated;
- multiple retained Workers or MapLibre sources can reintroduce memory growth.

### Non-goals

- changing the PMTiles basemap;
- allowing the browser to become the geometry authority;
- writing runtime-generated releases back to GitHub or Supabase;
- weakening exact validation for coastal pairs;
- storing a full geometry snapshot for every undo step;
- using handle-count reduction as the sole complexity control.

## 13. Final recommendation

The implementation should converge on:

```text
PMTiles immutable base
  + topology-safe display overlay
  + compact shared-arc edit bundle
  + transferable Worker state
  + sparse absolute operations
  + server-only exact validation
```

This design addresses both audited failure classes:

- moderate coastal pairs stop paying repeated index, outer-boundary, and structured-clone costs;
- extreme archipelago pairs never place hundreds of thousands of exact polygon vertices in the browser.

Until this complete path is available, extreme pairs must be rejected by a deliberate complexity gate rather than allowed to crash the browser.
