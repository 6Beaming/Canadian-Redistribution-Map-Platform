# Demo 2 Log — Frontend Feature Entry Shells

**Sprint:** Sprint 2 — UI/UX entry scaffolding  
**Branch:** `feature/demo-2-frontend-entries`  
**Date:** 2026-06-24  
**Status:** In progress — navigation shells and TO DO placeholders for upcoming features

---

## 1. Sprint objective

To be supplemented

---

## 2. Delivered frontend entry scaffolding

Sprint 2 step one adds **navigation entry points** and **page/panel shells** without implementing the underlying features. Existing map interaction (pan, zoom, DA/FED click, statistics content) is preserved. Placeholder views render **TO DO** until other teammates wire real workflows.

### 2.0 Summary of changes

| Category | Files |
|----------|--------|
| **New pages** | `UserSearchDA`, `UserProfile`, `UserResumeSubmission`, `UserViewStatistics`, `UserMakeComments`, `UserMakeObjection`, `UserMakeCounterProposal`, `CommissionerViewUserStats`, `CommissionerEvaluateReport`, `CommissionerSubWorkspace`, `CommissionerWorkspace`, `CommissionerInvitation` |
| **New components** | `UserMenuLeft`, `CommissionerMenuLeft`, `FeaturePlaceholder` |
| **Refactored** | `MapInfoPanel`, `UserHome`, `DashboardHome`, `Header`, `MySubmissions`, `SubmissionsTable`, `DashboardSubmissionsPage`, `App.jsx`, `map.css` |

### 2.1 New routes (`App.jsx`)

| Route | Page | Guard |
|-------|------|-------|
| `/users/search-da` | `UserSearchDA` | Public |
| `/users/profile` | `UserProfile` | Public |
| `/submissions/:submissionId` | `UserResumeSubmission` | Signed-in (client redirect on list page) |
| `/dashboard/invite` | `CommissionerInvitation` | `RequireCommissioner` |
| `/dashboard/workspace` | `CommissionerWorkspace` | `RequireCommissioner` |

Existing routes unchanged: `/`, `/users` → `UserHome`; `/submissions` → `MySubmissions`; `/dashboard` → `DashboardHome`.

### 2.2 Shared placeholder pattern

**`FeaturePlaceholder`** (`src/components/non_prebuilt/FeaturePlaceholder.jsx`)

- Renders a feature title, large **TO DO** text, and an optional red `note` line (used for commissioner activation hints).
- Full-page placeholders use standard page padding; InfoPanel placeholders use `map-info-panel__embedded` for correct in-panel spacing.

### 2.3 Public user surface (`UserHome`, `/users`)

#### Layout alignment

`UserHome` now uses the **same map layout as the commissioner dashboard**:

- `map-dashboard` grid: **75% / 25%** (map / InfoPanel).
- Top **spacer** + map occupying bottom **2/3** viewport height (`map-dashboard__spacer` + `map-dashboard__map-wrap`).
- Wrapped in `map-workspace` for the left menu overlay.

#### Left menu — `UserMenuLeft.jsx`

| Item | Behaviour |
|------|-----------|
| **Search for your DA** | Navigates to `/users/search-da` (full-page TO DO) |
| **Other Feature 1** | Disabled placeholder |
| **Other Feature 2** | Disabled placeholder |

- Thin rail on the far left; click toggles a panel expanding to the right.
- Open menu shows a dimmed backdrop over the map workspace (`side-menu__backdrop`).
- Menu layer sits above the map (`z-index: 20`).

#### Header — user routes

On `/`, `/users`, `/users/search-da`, `/users/profile`:

| Control | Action |
|---------|--------|
| **My Profile** | `/users/profile` (TO DO + **Back to map**) |
| **My Submissions** | `/submissions` (when signed in; unchanged) |
| **Sign In / Sign Out** | Auth flow (unchanged) |

#### InfoPanel decoupling — `MapInfoPanel` + `UserViewStatistics`

Statistics content moved from `MapInfoPanel` into **`UserViewStatistics.jsx`** (DA population, community, DGUID, FED “Coming Soon!”). `MapInfoPanel` is now a **shell** that:

1. Shows a **top-right dropdown** only when a DA or FED is selected on the map.
2. Reserves vertical space below the menu (`map-info-panel__content--with-menu`, `padding-top: 44px`) so titles do not overlap the dropdown.
3. Swaps panel content by mode (no full-page navigation for panel modes).

| Panel mode | Component | Content |
|------------|-----------|---------|
| **View Statistics** (default) | `UserViewStatistics` | Existing census / FED summary (Demo 1 behaviour) |
| **Make Comments** | `UserMakeComments` | TO DO inside panel |
| **Make an Objection   to Boundaries** | `UserMakeObjection` | TO DO inside panel |
| **Make a Counter-Proposal** | `UserMakeCounterProposal` | TO DO inside panel |

Panel view resets to **View Statistics** when the map selection changes.

#### Full-page user entries

| Entry | Route | Back navigation |
|-------|-------|-----------------|
| Search for your DA (from left menu) | `/users/search-da` | Back to map → `/users` |
| My Profile (from header) | `/users/profile` | Back to map → `/users` |
| Submission row click (`MySubmissions`) | `/submissions/:submissionId` | Back to submissions → `/submissions` |

### 2.4 Commissioner surface (`DashboardHome`, `/dashboard`)

#### Left menu — `CommissionerMenuLeft.jsx`

| Item | Behaviour |
|------|-----------|
| **Feature 1** | Disabled placeholder |
| **Feature 2** | Disabled placeholder |

Same expand/collapse and dim-backdrop pattern as `UserMenuLeft`.

#### Header — dashboard routes

On `/dashboard`, `/dashboard/graphs`, `/dashboard/submissionsTable`, `/dashboard/invite`:

| Control | Action |
|---------|--------|
| **Invite a new colleague** | `/dashboard/invite` (TO DO + **Back to dashboard**) |
| **All Submissions** | `/dashboard/submissionsTable` (unchanged) |
| **Sign In / Sign Out** | Auth flow (unchanged) |

`/dashboard/workspace` hides the global header (full-screen workspace shell).

#### InfoPanel — commissioner modes

Same shell as the public user panel (`variant="commissioner"`), with commissioner-specific menu labels:

| Panel mode | Component | Content |
|------------|-----------|---------|
| **View User Statictics** (default) | `CommissionerViewUserStats` | Reuses `UserViewStatistics` + red footer: *"This should be refactored to an aggregation statistical map of user submissions!"* |
| **Evaluate this Report** | `CommissionerEvaluateReport` | TO DO + red note: *"This page shoule be activated when the commissioner select a specific user submission on the map."* |
| **Activate Shared Workspace** | `CommissionerSubWorkspace` | TO DO + same red activation note + **Open in full workspace** button |

**Open in full workspace** navigates to `/dashboard/workspace` (`CommissionerWorkspace` — full-viewport TO DO with toolbar **Back to dashboard**).

#### Submissions table entry

`DashboardSubmissionsPage` → `SubmissionsTable`: each row click navigates to **`/dashboard/workspace`** (placeholder full workspace; no submission id binding yet).

`SubmissionsTable` accepts optional `onRowClick` callback for reuse.

### 2.5 Refactored files (behavioural notes)

| File | Change |
|------|--------|
| **`MapInfoPanel.jsx`** | Shell + dropdown; delegates content to page components; `variant` prop (`user` \| `commissioner`) |
| **`UserHome.jsx`** | Commissioner-aligned layout; `UserMenuLeft`; `MapInfoPanel variant="user"` |
| **`DashboardHome.jsx`** | `CommissionerMenuLeft`; `MapInfoPanel variant="commissioner"` |
| **`Header.jsx`** | My Profile, Invite a new colleague; route awareness for profile, search, submission detail, workspace |
| **`MySubmissions.jsx`** | Table rows clickable → `/submissions/:id` |
| **`map.css`** | `map-workspace`, `side-menu_*`, `map-info-panel__menu`, `map-info-panel__content--with-menu`, `map-info-panel__embedded`, `feature-placeholder_*`, `commissioner-workspace_*` |

### 2.6 Out of scope (deferred to other teammates)

- Real DA search, comments, objections, counter-proposals
- Submission create / resume persistence
- Commissioner evaluation workflow and shared workspace collaboration
- Left-menu Feature 1 / Feature 2 implementations
- Aggregated submission statistics map (commissioner stats refactor noted in red)

### 2.7 Quick verification

```bash
npm run dev
# Public user: http://localhost:5173/users
#   - Left menu → Search for your DA
#   - Click DA → InfoPanel menu → switch modes
#   - Header → My Profile
#   - Sign in → My Submissions → click a row

# Commissioner: http://localhost:5173/dashboard  (commissioner account)
#   - Left menu (placeholders)
#   - Click DA → InfoPanel commissioner menu
#   - Header → Invite a new colleague
#   - All Submissions → row → full workspace
```

---
