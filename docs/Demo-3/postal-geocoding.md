# Public-user Postal Geocoding

## 1. Purpose

The application converts a public user's Canadian postal code into a reusable
map centre. The backend calls Google's Geocoding API, stores the result in the
Supabase `profiles` table, and returns only the validated coordinates as the
user's `mapCenter`. The frontend then starts the map at that position. If no
valid stored centre is available, the map uses its Canada-wide default.

Coordinates are stored in the profile rather than in a cookie. The profile is
the durable source of truth across browsers and devices, while cookies remain
limited to authentication and temporary onboarding state.

## 2. The New Profile Columns

Migration
[`20260720210000_add_profile_postal_map_centers.sql`](../../supabase/migrations/20260720210000_add_profile_postal_map_centers.sql)
adds these nullable columns to `public.profiles`:

| Column | Type | Purpose |
| --- | --- | --- |
| `postal_latitude` | `double precision` | Latitude returned for the stored postal code. |
| `postal_longitude` | `double precision` | Longitude returned for the stored postal code. |
| `postal_geocoded_at` | `timestamptz` | Time of the last completed lookup, including a lookup that correctly returned no matching result. It controls when a missing result may be retried. |

The migration requires latitude and longitude to be either both present or both
absent. It also restricts latitude to `-90..90` and longitude to `-180..180`.
All three columns are nullable so authentication and onboarding can still
succeed when Google is unavailable or a postal code cannot be matched.


## 3. Geocoding Flow

The implementation is split between
[`server/lib/googleGeocoding.js`](../../server/lib/googleGeocoding.js) and
[`server/routes/auth.js`](../../server/routes/auth.js):

1. After a new public user completes phone OTP onboarding, the backend sends the
   normalized postal code, province, and `country:CA` to the Geocoding API.
2. The backend accepts only a result whose address components contain the exact
   postal code, Canadian country code, and expected province.
3. A successful result stores latitude, longitude, and the lookup timestamp on
   the profile.
4. Existing public users are checked during login and authenticated
   `GET /api/auth/me` session restoration. Google is called only when the
   stored state is eligible for a refresh.
5. Changing a public user's postal code or province through
   `PATCH /api/auth/me` makes the new address eligible immediately.
6. The public auth response exposes a validated `{ latitude, longitude }`
   `mapCenter`. It does not expose the server API key in the browser.
7. [`UserHome.jsx`](../../src/pages/UserHome.jsx) passes the centre to
   [`MapCanvas.jsx`](../../src/components/non_prebuilt/MapCanvas.jsx), which
   uses it when creating the map so there is no initial Canada-view camera jump.
8. When a stored centre is available, MapCanvas displays a **My Postal Area**
   location-pin control. Selecting it returns the map to the stored centre at
   postal-area zoom without making another Google request.

Commissioner profiles do not use public-user postal centering and are skipped by
this geocoding flow.

## 4. Retry and Call-suppression Rules

Valid latitude and longitude are sufficient to use the cached centre;
`postal_geocoded_at` controls retry timing for a missing result.

| Stored or request state | Behaviour |
| --- | --- |
| Valid latitude and longitude | Use the stored centre and do not call Google. |
| Postal code or province changed | Attempt geocoding immediately for the new value. |
| No coordinates and no valid `postal_geocoded_at` | Attempt on the next eligible login or `GET /api/auth/me`. This also backfills existing users after the migration. |
| Google returns no exact match | Store null coordinates and set `postal_geocoded_at`; retry after 30 days rather than on every launch. |
| Google returns a temporary/API/HTTP error | Log a server warning, do not write a completed-at timestamp, allow authentication to succeed, and retry on the next eligible authentication request. |
| Saving the geocode result to Supabase fails | Return the existing profile, allow authentication to succeed, and retry because no result was persisted. |
| Server API key is missing | Skip the call and timestamp; use the Canada default and retry after the key is configured. |

This makes geocoding a best-effort enhancement. A Google or database failure
must never prevent signup, login, session restoration, or profile editing.
