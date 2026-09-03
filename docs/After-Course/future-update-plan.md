# Future Counter-Proposal Canonical Mesh Plan

## 1. Status and objective

This document defines a future implementation plan. It does not describe functionality that is complete in the current release.

The remaining Counter-Proposal scalability defect is architectural: editing a DA pair still brings exact source geometry into the browser and repeatedly validates complete polygons. A DA with a highly detailed or fragmented boundary can therefore make opening the editor, dragging a handle, committing an edit, or calculating impact unacceptably slow and can exhaust browser memory.

The target is to replace that runtime model with one immutable canonical operational mesh:

- source GeoJSON is an offline build input and provenance record only;
- the canonical mesh is the only geometry used for runtime overlays, editing, validation, impact calculation, submission materialization, Archived Tree transitions, and exports;
- PMTiles and Google Maps remain independent visual basemap layers and do not participate in Counter-Proposal geometry calculations;
- all edits are stable sparse operations against a versioned mesh;
- pointer-move validation is local and indexed, never a complete JSTS overlay loop.

This is a new release contract. It must not silently change the meaning of the existing `statscan-da-2021-r1` release.

## 2. Existing implementation audit

### 2.1 Measured failure modes

Measurements against `statscan-da-2021-r1` show that editable-handle count is not a reliable proxy for geometry cost.

| Representative area or pair | Exact pair vertices | Rings | Approximate expanded geometry cost | Consequence |
| --- | ---: | ---: | ---: | --- |
| Saanich--Gulf Islands pair | 11,674--13,024 | 49--124 | about 9--10 MB before renderer overhead | avoidable latency and repeated topology work |
| Sunshine Coast pair | 25,864 | 9 | about 20 MB | moderate memory and interaction pressure |
| North Island--Powell River outlier pair | 711,985 | thousands | about 534 MB before MapLibre/GPU overhead | opening the editor can OOM |

The audited extreme pair has only a few hundred fine-LOD handles. Reducing visible handle markers alone cannot remove the exact payload, full edge index, outer-boundary expansion, JSTS objects, MapLibre triangulation, or Worker clone.

### 2.2 Current hot path

The current implementation:

1. reads both exact DA features before selecting a shared-arc LOD;
2. inserts selected release vertices into complete polygon rings;
3. clones original and current full features;
4. builds `buildDaObjectionIndex()` across every ring edge;
5. derives full shared and outer boundaries;
6. structured-clones the cache into a Worker;
7. performs full `union`, `covers`, `intersection`, and `equalsTopo` validation during handle movement;
8. performs up to 16 full checks while binary-searching an invalid pointer position;
9. rebuilds complete indexes and recalculates full polygon impacts after commits, undo, and redo;
10. materializes the proposal against exact coordinate arrays on the server.

Important implementation locations are:

- `scripts/reusable/build_map_release.py`: current streaming release and shared-arc LOD builder;
- `server/lib/map/canonicalReleaseStore.js`: exact pair reads and LOD selection;
- `src/lib/map/releasePairLoader.js`: browser pair loading and cache construction;
- `src/lib/map/counterProposalWorkflow.js`: complete feature/index/topology/impact operations;
- `src/lib/map/objectionWorkflow.js`: full edge-owner and pair boundary indexes;
- `src/services/counterProposalWorkerClient.js`: Worker transport;
- `src/lib/map/counterProposalWorkerDomain.js`: Worker-owned full cache;
- `server/lib/map/geometryOperations.js`: stable sparse operation derivation and materialization;
- `server/lib/map/counterProposalSubmission.js`: authoritative submission validation;
- `server/lib/archive/`: Archived Tree materialization, merge, revert, delete, and export.

### 2.3 Root cause

The root cause is not merely too many handles. It is that exact source coordinates remain part of the runtime representation.

With `N` exact coordinates, the current browser cost is approximately:

```text
open:       O(N) parsing + indexing + rendering
preview:    O(1..16 * N), with overlay operations often worse than linear
memory:     multiple O(N) object graphs and cross-thread clones
```

The target mesh contains `M` bounded operational vertices and a local guard index. The target cost is:

```text
open:       O(M + G)
preview:    O(log G + K)
memory:     O(M + G)
```

`G` is the compact guard artifact and `K` is the small set of nearby segments returned by the spatial query.

## 3. Frozen architectural decisions

### 3.1 Geometry authority

The canonical operational mesh is the only runtime geometry authority for Counter-Proposals.

| Representation | Runtime role | Persistence role |
| --- | --- | --- |
| Source exact GeoJSON | none | offline input, checksum, provenance, and reproducible rebuild only |
| Canonical operational mesh | rendering, editing, validation, impact, adjacency, and navigation | immutable release artifact and geometry basis |
| PMTiles/Google Maps | visual geographic context only | independent basemap artifact |

Exact GeoJSON must not be returned by a browser-facing Counter-Proposal route, placed in React state, sent to MapLibre as an editable overlay, cloned to a Worker, or loaded during submission/archive execution.

### 3.2 One global topology, not pair-specific GeoJSON copies

The mesh is stored as canonical arcs plus directed per-DA references. It is logically capable of materializing a complete GeoJSON geometry, but complete GeoJSON is not duplicated for every DA pair.

Each shared arc is stored once. Both owners refer to the same arc in opposite directions. Junctions shared by three or more regions have one stable identity. This is required for deterministic replay and Archived Tree LWW behavior.

### 3.3 Mesh-relative operation semantics

Runtime and persistence may store deltas because the immutable mesh already owns every base coordinate. A stored delta must always be relative to that immutable base, never relative to the previously applied command.

```text
final coordinate = immutable mesh base coordinate + base-relative delta
```

The operation is idempotent. Replaying it twice produces the same final coordinate.

All coordinates and derived results must use the release's declared quantization rule. The initial contract retains eight decimal places for longitude and latitude unless measurement proves that another precision is required.

### 3.4 Server authority remains mandatory

The browser and server use the same mesh, eliminating exact-versus-display disagreement. The server still treats all client results as untrusted and repeats final validation before persistence or archive transition.

### 3.5 New immutable release

The canonical mesh must be published under a new immutable release identity, for example `statscan-da-2021-mesh-r1`. Existing release bytes and historical records must never be rewritten in place.

## 4. Frozen release contract

### 4.1 Release layout

```text
src/data/map/releases/<releaseId>/
  release.json
  mesh/
    arcs-000.bin
    arcs-001.bin
    arcs.index.json
    vertices.bin
    da-arc-refs.json
    pair-arc-refs.json
    guard-segments-000.bin
    guard-segments.index.json
  indexes/
    dguids.json
    feds.json
    pruids.json
    adjacency.json
    pair-complexity.json
  validation/
    source-audit.json
    coverage-report.json
    accuracy-report.json
    performance-budget.json
```

Artifacts may use NDJSON during the first implementation if binary formats would delay correctness. They must remain sharded, range-addressable, content-hashed, and below the repository file-size gate.

### 4.2 Manifest identity

`release.json` must include at least:

```json
{
  "schemaVersion": "2.0",
  "releaseId": "statscan-da-2021-mesh-r1",
  "sourceDataset": "Statistics Canada 2021 DA",
  "sourceGeometryRevision": "sha256:...",
  "meshRevision": "sha256:...",
  "topologyRevision": "sha256:...",
  "meshSchemaVersion": "canonical-coverage-mesh-v1",
  "operationSchemaVersion": "base-relative-delta-v1",
  "normalizationVersion": "wgs84-8dp-v1",
  "metricCrs": "frozen projected CRS identifier",
  "builderVersion": "canonical-mesh-builder-v1",
  "simplificationParameters": {},
  "counts": {},
  "artifacts": [],
  "manifestSha256": "sha256:..."
}
```

The active Supabase `map_data_releases` row and local manifest must agree on `releaseId`, `manifestSha256`, `sourceGeometryRevision`, `meshRevision`, and `topologyRevision`. The server must fail closed on disagreement.

### 4.3 Arc and DA references

An arc owns ordered mesh vertices and immutable endpoints:

```json
{
  "arcId": "ma1_...",
  "owners": ["DA_A", "DA_B"],
  "vertices": [
    {"vertexId": "mv1_...", "coordinate": [-123.1, 49.2], "locked": true},
    {"vertexId": "mv1_...", "coordinate": [-123.0, 49.3], "locked": false}
  ]
}
```

A DA references arcs with direction and ring structure:

```json
{
  "dguid": "DA_A",
  "polygons": [
    {
      "outer": [
        {"arcId": "ma1_...", "direction": 1},
        {"arcId": "ma1_...", "direction": -1}
      ],
      "holes": []
    }
  ]
}
```

The materializer must verify ring continuity before producing GeoJSON.

### 4.4 Pair edit bundle

The browser-facing pair response contains no source exact feature:

```json
{
  "schemaVersion": "2.0",
  "releaseId": "statscan-da-2021-mesh-r1",
  "meshRevision": "sha256:...",
  "pair": ["DA_A", "DA_B"],
  "mesh": {
    "daArcRefs": [],
    "arcRecords": [],
    "editableVertexIds": [],
    "lockedVertexIds": [],
    "baseBounds": []
  },
  "guard": {
    "maximumDisplacementMeters": 0,
    "corridor": {},
    "segmentIndex": {}
  },
  "metrics": {
    "baseAreas": {},
    "basePopulations": {}
  },
  "complexity": {}
}
```

### 4.5 Sparse operation

```json
{
  "schemaVersion": "1.0",
  "operationId": "uuid",
  "releaseId": "statscan-da-2021-mesh-r1",
  "meshRevision": "sha256:...",
  "pair": ["DA_A", "DA_B"],
  "meshVertexId": "mv1_...",
  "deltaLng": 0.00001234,
  "deltaLat": -0.00000567
}
```

The server resolves the base coordinate from the immutable release, adds the quantized delta once, and rejects unknown, locked, non-pair, duplicate, non-finite, or out-of-range operations.

For Archive LWW state, the resolved vertex state is:

```json
{
  "meshVertexId": "mv1_...",
  "deltaLng": 0.00001234,
  "deltaLat": -0.00000567,
  "lastMergeSequence": 42,
  "sourceArchiveVersionId": "uuid"
}
```

## 5. Canonical mesh builder

### 5.1 Reuse the existing build foundation

Extend `scripts/reusable/build_map_release.py`. Preserve its current strengths:

- streaming source shard reads;
- SQLite-backed edge occurrence data;
- disk-backed temporary state;
- deterministic ordering;
- stable hashes;
- resumable staging output;
- bounded artifact shards;
- single-writer topology pass.

Do not load all Canadian source geometry into one Python object.

### 5.2 Phase A: source audit and normalization

1. Freeze the source manifest and checksum every source shard.
2. Normalize coordinates using the declared precision.
3. Validate every Polygon/MultiPolygon, ring closure, orientation, and DGUID.
4. Detect duplicate positions and zero-length edges.
5. Build the source edge occurrence database.
6. Verify that the source coverage is suitable for topology processing; emit invalid edges and stop if it is not.
7. Project geometry into the frozen metric CRS before simplification and measurement.

The builder must never silently repair a source topology defect. Any permitted normalization or repair must be deterministic and recorded in `source-audit.json`.

### 5.3 Phase B: global canonical arc graph

1. Identify edges with one owner and edges with two owners.
2. Identify graph junctions, including all vertices whose incident owner set or degree changes.
3. Split edge sequences into maximal canonical arcs between locked junctions.
4. Assign arc IDs independent of a DA pair.
5. Assign mesh vertex IDs within the immutable release namespace.
6. Record every arc owner and the direction in which each owner traverses it.
7. Reconstruct every original DA ring from directed arc references.
8. Verify reconstruction against normalized source geometry before simplifying anything.

This replaces the current pair-owned shared-arc identity. A junction or shared primitive must not receive different IDs merely because it appears in more than one pair.

### 5.4 Phase C: topology-aware adaptive simplification

Use coverage-aware simplification rather than simplifying each DA independently. Shapely `coverage_simplify` backed by GEOS 3.12 or newer is the preferred initial implementation.

The simplifier must:

- preserve locked junctions and ring closure;
- simplify a shared arc once for all owners;
- preserve the owner and adjacency graph;
- preserve required components and holes;
- prevent an arc from crossing a non-incident arc;
- preserve minimum-clearance requirements;
- use metric, not longitude/latitude-degree, tolerances;
- adapt tolerance per arc or connected partition when validation fails.

Uniform handle spacing is not the primary simplification algorithm. After topology-aware simplification, densify any chord that exceeds the configured maximum physical length. This produces geographically usable handle spacing without discarding critical curvature points.

### 5.5 Partitioning and memory safety

National coverage validation may exceed the build machine's memory if processed as one geometry collection. Partition work by connected spatial tiles, provinces, or FED groups, but:

- lock every cut-edge vertex shared with another partition;
- include a validation halo around each partition;
- never simplify the same canonical arc independently in two partitions;
- perform a final national edge-match and adjacency pass;
- keep intermediate topology in SQLite or another disk-backed store;
- checkpoint every completed phase and support `--resume`;
- enforce the existing configurable memory budget.

### 5.6 Accuracy feedback loop

The initial target remains no more than 1% relative area error per DA, but this is not the only acceptance criterion and must not be described as a confidence interval.

For each candidate mesh:

1. reconstruct affected DAs;
2. run coverage validity;
3. compare source and mesh area;
4. compute symmetric-difference area;
5. measure shared-boundary Hausdorff deviation in the metric CRS;
6. verify component, hole, adjacency, and junction preservation;
7. replay a frozen set of representative boundary moves and compare impact results;
8. reduce tolerance for failed arcs and repeat.

The maximum visual deviation must be derived from the minimum supported edit zoom and a frozen pixel-error budget. The release configuration records both the pixel budget and resulting meter thresholds. Area success must never override a failed topology or maximum-deviation gate.

### 5.7 Handle policy

Every editable vertex belongs to the canonical mesh. The map line always renders the complete operational mesh line, so there is no hidden exact chain behind a visible chord.

The builder records:

- locked junction/end vertices;
- editable interior vertices;
- physical distance to neighboring vertices;
- local curvature/error contribution;
- pair-level editable count and total mesh count.

If a fidelity gate requires more vertices than the interaction budget permits, the build must report the pair as over budget. It must not silently weaken fidelity. The product may then raise the budget, tune the minimum edit zoom, or adopt a later control-cage model.

### 5.8 Guard artifacts

For each editable arc or pair:

1. define a maximum displacement or legal movement corridor;
2. spatially select only mesh segments that can interact with that corridor;
3. encode those segments in compact transferable buffers;
4. build a compact spatial index;
5. record the guard count, bytes, and hash;
6. verify the guard result against a complete mesh validation corpus.

Unbounded movement cannot have a bounded, complete guard artifact. The first implementation must therefore freeze a maximum displacement/corridor rule.

### 5.9 Artifact and manifest generation

Write artifacts to a staging directory, validate them there, generate hashes and the manifest last, and atomically publish the completed release. Never modify an already published release directory.

## 6. Release validation gates

### 6.1 Topology gates

The release fails if any condition is false:

- every mesh DA is a valid Polygon/MultiPolygon;
- interiors do not overlap;
- shared edges are exactly edge-matched;
- no unintended gap is introduced;
- all DGUIDs remain represented;
- feature, component, and required-hole policies are satisfied;
- source and mesh adjacency graphs match;
- junctions and locked endpoints retain their identities;
- every DA ring can be reconstructed continuously from directed arcs;
- every pair union remains stable under its editable shared-arc partition.

### 6.2 Accuracy gates

Record and enforce:

- relative DA area error, with an initial maximum of 1%;
- absolute DA area error;
- symmetric-difference area and ratio;
- densified Hausdorff distance for each shared arc;
- maximum chord length;
- minimum clearance;
- exact-versus-mesh impact difference for the regression edit corpus;
- population estimate difference under the frozen impact model.

Thresholds other than the 1% initial area target must be frozen in a checked-in build configuration after calibration. Changes require a new release identity.

### 6.3 Determinism gates

- two clean builds from identical inputs produce identical artifact hashes;
- build order, worker count, operating system path separator, and newline style do not change identity;
- every arc and vertex ID is stable within the release;
- all coordinates are quantized before hashing;
- manifest identity covers source hashes, builder version, parameters, schemas, and artifacts.

### 6.4 Repository and build gates

- no artifact exceeds the configured Git limit;
- the builder remains within `--max-memory-mb`;
- all phases support explicit progress reporting;
- interrupted builds can resume without accepting partial output;
- source exact assets are excluded from runtime packaging once cutover completes;
- current and previous immutable releases remain independently verifiable.

## 7. Runtime implementation plan

### 7.1 Pair-open API

Add a canonical mesh pair endpoint under the existing public map API. It returns the pair edit bundle and no exact source geometry.

The server must:

1. resolve the active release;
2. validate local/Supabase release identity;
3. verify that both DGUIDs are Enabled and adjacent;
4. range-read only referenced mesh/guard artifacts;
5. return a bounded response with cache validators;
6. reject missing, corrupt, stale, or over-budget artifacts without falling back to Yukon or another release.

Network contract tests must fail if a browser-facing pair response contains source exact geometry.

### 7.2 Rendering

MapLibre sources should contain only:

- selected canonical mesh DA overlay or compact pair materialization;
- original shared mesh line;
- proposed shared mesh line;
- changed-area fill;
- editable handles.

PMTiles continues to show detailed immutable geography below the overlay. Exact GeoJSON is not used to preserve coastline detail in the overlay.

Opening another pair must abort outstanding requests, remove prior pair sources, terminate or reset pair-specific Worker state, and release all previous buffers.

### 7.3 Worker ownership

The Worker owns compact typed-array mesh state and the guard spatial index. Use transferable `ArrayBuffer` ownership where practical.

```text
INIT(mesh buffers, guard buffers, metrics)
  -> READY(summary)

PREVIEW_MOVE(meshVertexId, targetCoordinate, sequence)
  -> PREVIEW_RESULT(validCoordinate, changedSegments, impactDelta, sequence)

COMMIT_MOVE(meshVertexId, targetCoordinate, sequence)
  -> COMMIT_RESULT(baseRelativeOperation, changedSegments, accumulatedImpact)

UNDO / REDO
  -> COMMIT_RESULT(changedOperations, changedSegments, accumulatedImpact)
```

The Worker never receives or returns a complete source or mesh FeatureCollection after initialization.

### 7.4 Local pointer-move validation

At most one preview is active per animation frame. Reject stale sequence numbers.

For a moved vertex, validate only:

1. finite coordinate and maximum displacement;
2. legal corridor containment;
3. the two incident chords or other bounded incident set;
4. intersections with guard segments returned by the spatial index;
5. minimum node/segment clearance;
6. orientation and local fold constraints;
7. local changed-area contribution.

Do not rebuild a DA index, construct a full MultiLineString, materialize both DA polygons, or run full JSTS overlay during pointer movement. Invalid pointer positions may be clipped to the corridor and refined with a small local search; the current unconditional 16 full-topology binary checks must be removed.

### 7.5 Incremental impact

Store base metric area and the shoelace contribution around each mesh vertex. Moving one vertex updates only its incident terms.

The existing population model is area-proportional and remains an estimate. Version the new result, for example `mesh-area-proportional-v2`, and calculate it from the frozen metric CRS and mesh area model. The server recalculates the authoritative result during submission.

### 7.6 History

Undo and redo store base-relative vertex states or bounded operation patches, never geometry snapshots. History limits are expressed in operation count and buffer bytes.

## 8. Submission, persistence, and Archived Tree

### 8.1 Submission validation

The client submits release identity, canonical pair, and ordered base-relative operations.

The server transaction:

1. verifies active `releaseId` and `meshRevision`;
2. validates operation schema and unique vertex IDs;
3. resolves immutable base coordinates;
4. materializes proposed mesh coordinates once;
5. runs complete canonical-mesh topology and scope validation;
6. calculates authoritative area/population impact;
7. persists the geometry revision and operations atomically;
8. returns a geometry-free submission projection plus validation summary.

The existing tables may be evolved rather than replaced, but each revision and operation must unambiguously identify the mesh operation space. Existing exact-release rows must remain distinguishable.

### 8.2 Archived Tree merge and LWW

Archived Tree uses the same `meshVertexId` namespace and base-relative delta.

- merge time, not submission time, determines LWW sequence;
- the latest state for a vertex is one delta plus the winning merge sequence;
- unrelated arcs remain unchanged;
- merge/revert validates the resulting global archived mesh before commit;
- branch and global archive revisions record `releaseId` and `meshRevision`;
- Counter-Proposal branch snapshots contain materialized canonical mesh GeoJSON, not source exact GeoJSON;
- Comment and Objection branches remain geometry-free and materialize base mesh geometry only for map/export views.

Revert restores only the branch-owned arc states from the selected historical version, preserves unrelated current arcs, validates the global result, and creates a new monotonic map revision.

Delete Forever resets the affected branch vertices to zero base-relative delta, applies the existing submission/workspace state semantics, validates the global result, and records a delete transition.

### 8.3 Export

Export keeps its schema version independent from `releaseId`. It must include:

- export `schemaVersion`;
- `releaseId` and `meshRevision`;
- archive map revision sequence;
- branch/version metadata and submission projections;
- base-relative operations;
- directly parseable materialized canonical mesh GeoJSON where the export contract requires geometry;
- the impact method/version.

The export must identify the geometry as the project's canonical operational mesh derived from the declared source revision.

## 9. Compatibility and cutover

### 9.1 Historical releases

Existing operations reference the old exact shared-vertex catalog and cannot be silently reinterpreted as mesh operations.

Choose and document one policy before cutover:

1. retain old releases for read-only historical materialization; or
2. mark old submissions/archive geometry superseded under the project's metadata-change rule and preserve their existing exported snapshots for audit.

An in-place vertex-ID translation is prohibited unless a migration proves an unambiguous source-to-mesh mapping for every operation.

### 9.2 Staged activation

1. Register the new release as inactive.
2. Run all offline release gates.
3. Run API/runtime tests against an explicit non-active release ID.
4. Back up relevant Supabase geometry/archive tables.
5. Deploy code capable of reading both old historical and new mesh contracts.
6. Activate the mesh release atomically.
7. Confirm local manifest and Supabase identity at server startup.
8. Run browser and API smoke tests.
9. Remove exact source geometry from runtime packaging only after rollback confidence is established.

Rollback reactivates the prior release and compatible code path; it never rewrites either release.

## 10. Implementation sequence

### Phase 0: measurement and frozen regression corpus

- Preserve the audited ordinary, island, coastal, and extreme pairs.
- Add MultiPolygon, multiple-shared-arc, hole, narrow-corridor, cross-FED, cross-province, and three-way-junction fixtures.
- Record current payload, open duration, preview duration, Worker clone duration, JS heap, renderer memory, submission duration, and archive transition duration.
- Freeze build and runtime performance budgets.

### Phase 1: canonical arc graph

- Upgrade pair-owned edges to global canonical arcs.
- Generate stable junction, arc, and vertex identities.
- Generate directed DA ring references.
- Prove exact reconstruction before simplification.
- Extend deterministic and resume tests.

### Phase 2: mesh simplification and gates

- Add the projected metric build stage.
- Add coverage-aware adaptive simplification.
- Add maximum-chord densification.
- Add topology, area, symmetric-difference, Hausdorff, adjacency, and determinism gates.
- Iterate first on the frozen corpus, then one FED, one province, and finally the national release.

### Phase 3: guard and metric artifacts

- Freeze movement-corridor policy.
- Generate compact guard segments and spatial indexes.
- Generate base area, local shoelace, population, and complexity metadata.
- Verify local guard decisions against complete mesh validation.

### Phase 4: mesh read API and renderer

- Add the mesh pair endpoint.
- Add hash/range/cache validation.
- Render only canonical mesh overlays.
- Ensure pair switching releases all prior resources.
- Add a network assertion that exact source geometry is absent.

### Phase 5: incremental Worker editor

- Replace full-cache Worker messages with compact transferable state.
- Implement coalesced local previews.
- Implement base-relative operation history.
- Implement constant/local impact updates.
- Remove complete JSTS and index rebuilds from the pointer hot path.

### Phase 6: server submission and persistence

- Validate mesh release identity.
- Accept and normalize base-relative operations.
- Materialize and fully validate canonical mesh once per submission.
- Persist mesh revision identity and authoritative impacts.
- Preserve geometry-free list/query behavior.

### Phase 7: Archived Tree and export

- Apply mesh operations through merge, LWW, revert, and delete.
- Validate global archived mesh transitions.
- Update branch/map materializers and caches.
- Version and verify export geometry semantics.

### Phase 8: cutover and retirement

- Complete compatibility decision and backups.
- Activate the new release.
- Run full integration and browser acceptance.
- Confirm no runtime exact geometry request, parse, clone, or materialization remains.
- Remove source exact assets from deployment packaging while preserving offline provenance and rebuild inputs.

## 11. Acceptance criteria

### 11.1 Functional

- Every Enabled adjacent DA pair with a valid mesh bundle can enter the editor.
- Original and proposed lines are derived from the same canonical mesh used for validation.
- Handles are deterministic for a release.
- Undo/redo/reload reproduces the same coordinates and impact.
- Submission, Commissioner review, merge, revert, delete, Archived Map, and export preserve mesh identity and geometry.
- Stale or mismatched releases fail closed.

### 11.2 Performance

- Browser pair-open responses contain no source exact GeoJSON.
- Extreme source complexity does not proportionally increase runtime payload or memory.
- Pointer preview performs no complete polygon overlay and no complete pair-index rebuild.
- Preview p95 meets the frozen interaction-frame budget on the reference test machine.
- Repeated pair open/close does not produce monotonically growing heap or Worker counts.
- The frozen extreme pair opens, edits, submits, merges, reverts, and deletes without OOM.

### 11.3 Geometry and impact

- All topology, accuracy, adjacency, and determinism gates in Section 6 pass.
- Relative area error is at most the frozen target, initially 1%, for every DA.
- No DA passes solely because positive and negative local errors cancel.
- Impact differences for the frozen edit corpus remain within explicit absolute and relative limits.
- Area calculations use the declared metric model rather than the current Web Mercator approximation.

### 11.4 Integration

- Existing Comment and Objection workflows remain functional.
- Normal map browsing continues to use PMTiles/Google Maps independently.
- Public and Commissioner submission lists remain geometry-free.
- Realtime payloads contain projections/identities, not mesh geometry.
- Archive operations remain atomic and version-conflict safe.
- Full automated regression, browser acceptance, and production-container health checks pass before activation.

## 12. Principal risks

- Source data may not initially form a clean edge-matched coverage after normalization.
- Per-partition simplification can create inconsistent cut edges unless canonical arcs are owned globally.
- A 1% whole-DA area gate can conceal unacceptable local displacement.
- Fidelity requirements may force more mesh vertices than the initial interaction budget permits.
- Changing from exact-source to operational-mesh authority changes the semantic meaning of stored geometry and exports.
- Historical exact-release operations cannot be remapped automatically.
- Removing source exact assets too early would prevent rollback or historical materialization.

These risks are controlled by immutable release identities, global arc ownership, multi-metric gates, staged activation, and an explicit historical compatibility policy.

## 13. Completion definition

This future update is complete only when the canonical mesh is reproducibly built and validated, exact GeoJSON has left every Counter-Proposal runtime path, local indexed previews replace complete per-frame overlays, submission and Archived Tree use the same mesh-relative operation model, the extreme regression corpus passes without OOM, and the release can be activated or rolled back without rewriting historical data.
