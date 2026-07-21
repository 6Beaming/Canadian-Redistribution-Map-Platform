# Pre-centred Map Features

## 1. Purpose

The application opens the map near the signed-in user's saved area instead of
always starting with the Canada-wide view. Public users and Commissioners use
different profile information because their map responsibilities have different
scales, while anonymous users use the Canada default:

| Role | Saved profile value | Initial map view |
| --- | --- | --- |
| Anonymous user | None | Canada default bounds, with a re-center control |
| Public user | Postal code, represented by cached latitude and longitude | A local point at zoom level 12, with a postal-area marker and return control |
| Commissioner | Province or territory code | A province-sized viewport or a configured regional camera, with a light-blue province highlight and re-center control |

All three flows prepare the initial camera before MapLibre creates the map. This
prevents the map from first displaying Canada and then visibly moving to the
profile location one or two seconds later.

## 2. Shared Map Camera Contract

[`MapCanvas.jsx`](../../src/components/non_prebuilt/MapCanvas.jsx) accepts a
`mapSearchTarget` in one of two shapes.

A point target is used for a postal area, a place search, or a configured
regional focus:

```js
{
  label: "Selected location",
  location: [longitude, latitude],
  zoom: 12,
  showMarker: false
}
```

A viewport target is used when the complete extent of a large area should fit
inside the map:

```js
{
  label: "Ontario",
  viewport: [
    [westLongitude, southLatitude],
    [eastLongitude, northLatitude]
  ],
  fitBoundsOptions: {
    padding: 48,
    maxZoom: 8
  },
  showMarker: false
}
```

During construction, MapCanvas applies the target as its `center` and `zoom`
or as its `bounds` and `fitBoundsOptions`. A target received after the map is
ready uses an animated `flyTo()` or `fitBounds()` transition. If neither target
shape is valid, MapCanvas uses the Canada default bounds.

`showMarker` controls the generic search-result marker. Role-specific markers
and highlights are managed separately.

## 3. Public-user Postal-area Centring

### 3.1 Durable profile data

Public-user centring uses these nullable columns in `public.profiles`:

| Column | Purpose |
| --- | --- |
| `postal_latitude` | Cached latitude for the validated postal code |
| `postal_longitude` | Cached longitude for the validated postal code |
| `postal_geocoded_at` | Time of the last completed lookup, including a valid no-match result |

Coordinates belong in the profile rather than a cookie so the same centre is
available across browsers and devices. Authentication cookies do not contain
map coordinates.

The backend implementation is split between
[`googleGeocoding.js`](../../server/lib/googleGeocoding.js) and
[`auth.js`](../../server/routes/auth.js). It calls the Google Geocoding API only
when the stored postal state is eligible for geocoding. A result is accepted
only when its postal code, Canadian country code, and province match the saved
profile values.

### 3.2 Frontend flow

The authentication response exposes valid cached coordinates as:

```js
mapCenter: {
  latitude,
  longitude
}
```

[`UserHome.jsx`](../../src/pages/UserHome.jsx) converts this value into a point
target at zoom level 12 and passes it to MapCanvas in two ways:

- as the default `mapSearchTarget`, so the initial map is centred immediately;
- as `postalAreaTarget`, so the postal-area marker and control remain available
  even after the user searches for another place.

MapCanvas draws a blue marker at the cached postal-area coordinate. The **My
Postal Area** control returns the camera to that coordinate without calling
Google again. The profile target sets `showMarker: false` because this dedicated
postal marker replaces the generic search-result marker.

### 3.3 Retry and fallback behaviour

| State | Behaviour |
| --- | --- |
| Valid cached coordinates | Use them immediately and do not call Google. |
| Postal code or province changed | Geocode the new combination immediately. |
| Missing coordinates with no completed attempt | Retry on the next eligible authentication request. |
| Exact match not found | Cache the completed attempt and retry after 30 days. |
| Temporary Google or network error | Keep authentication successful, leave the attempt incomplete, and retry later. |
| Server API key missing | Skip geocoding and use the Canada default until the key is configured. |
| Invalid or missing returned coordinates | Omit the postal target, marker, and control; use the Canada default unless a place search is active. |

The full geocoding, validation, migration, and retry rules are documented in
[`postal-geocoding.md`](./postal-geocoding.md).

## 4. Commissioner Province Centring

### 4.1 Local province views

Commissioners do not use postal coordinates. [`DashboardHome.jsx`](../../src/pages/DashboardHome.jsx)
reads `user.province` from the authenticated profile and passes it to
[`getProvinceMapView()`](../../src/lib/map/provinceView.js).

`provinceView.js` contains the 13 supported province and territory codes, their
Statistics Canada PRUID values, and their camera configuration. The normal
configuration is a viewport generated from the bundled 2023 FED boundaries.
MapLibre fits the viewport with padding and computes the appropriate zoom for
the available screen size.

Some areas need a closer configured point camera. Yukon is tall relative to the
wide Commissioner dashboard, so fitting its complete north-south extent would
make Yukon occupy only a narrow part of the screen. Its local configuration
therefore uses a closer southern/central focus while retaining surrounding
geographic context.

This lookup is completely local. Opening the Commissioner dashboard does not
call Google Geocoding or Places, and no province latitude or longitude columns
are required in Supabase. The existing `province` profile value is sufficient.

### 4.2 Province highlight

DashboardHome also passes the selected province's PRUID to MapCanvas as
`highlightedProvincePrUid`. The `province-highlight` layer filters the bundled
FED source by the first two digits of each `fed_num`, which correspond to its
province or territory PRUID.

The matching FED polygons receive a subtle light-blue fill. This communicates
the Commissioner's assigned area without placing a misleading single pin in a
province-sized region. The highlight is hidden while rollout presentation mode
is active so it does not distort rollout category colours.

If the saved province code is missing or unsupported, `getProvinceMapView()`
returns `null`. MapCanvas then uses the Canada default and applies no province
highlight.

When a Commissioner saves a different province through the profile page, the
authentication context receives the updated profile. The next Commissioner map
render uses the newly saved province view. The profile page's separate
10-second confirmation protects this high-impact change before it is saved.

## 5. Role-specific Re-centering Controls

MapCanvas accepts an optional `recenterTarget` for the dedicated **Re-center
map** control. The control uses the same local target that established the
role's initial camera, so clicking it does not call Google or change profile
data.

- [`DashboardHome.jsx`](../../src/pages/DashboardHome.jsx) passes the
  Commissioner's saved province target. Clicking the control returns to that
  province's configured viewport or point camera. If the province is missing or
  unsupported, it returns to the Canada default bounds.
- [`UserHome.jsx`](../../src/pages/UserHome.jsx) enables the control only after
  authentication has confirmed that the visitor is signed out. Anonymous users
  return to the Canada default bounds.
- Signed-in public users do not receive the new re-center control. Their existing
  **My Postal Area** marker and button remain unchanged and continue returning
  to their cached postal coordinates.

For a viewport target, MapCanvas uses an animated `fitBounds()` transition. For
a configured point target, it uses `flyTo()` with the target's original zoom.
The Canada fallback also uses `fitBounds()`. Re-centering does not clear a
selected DA or FED, submission state, or an active workflow.

The top-right control uses a crosshair-style SVG, a light-blue background, the
tooltip **Re-center map**, and an accessible label describing its return to the
default position. The control is added and removed with the same MapLibre
control lifecycle as the other map buttons.

## 6. Camera Priority

The Google Places search target always takes priority over a profile-derived
starting target.

| Priority | Anonymous map | Public-user map | Commissioner map |
| --- | --- | --- | --- |
| 1 | Active Places search result | Active Places search result | Active Places search result |
| 2 | Canada default bounds | Cached postal-area point | Saved province view |
| 3 | — | Canada default bounds | Canada default bounds |

For public users, searching moves the camera but does not remove the postal-area
marker or **My Postal Area** control. Commissioners keep the province highlight
after a search, unless rollout mode hides it. A search does not overwrite any
profile location data.

Focused objection, Counter-Proposal, Workspace review, and archived-difference
flows may later fit exact workflow GeoJSON. That camera movement is intentional
and is separate from the initial profile-based centring described here.

## 7. API Usage and Data Ownership

| Concern | Anonymous user | Public user | Commissioner |
| --- | --- | --- | --- |
| Durable source of truth | None | Supabase postal coordinates and timestamp | Supabase `province` code |
| Initial camera lookup | Built-in Canada bounds | Cached `mapCenter` in the auth response | Local `provinceView.js` lookup |
| Google request on normal launch | None | Only when postal retry rules require it | None |
| Google API used to create the profile view | None | Server-side Geocoding API | None |
| Map indicator | None | Blue postal marker | Light-blue province highlight |
| Return control | **Re-center map** to Canada | **My Postal Area** | **Re-center map** to the saved province, or Canada as a fallback |

The browser Places API remains responsible only for user-entered searches. The
Google raster tile session provides the visual basemap. Neither service is the
source of electoral boundaries or Commissioner province assignments.
