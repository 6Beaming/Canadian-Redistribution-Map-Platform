# Authentication Workflow

This document explains how authentication is implemented in the app, how Supabase is used, which API routes exist, and which frontend/backend files participate in each workflow.

## Main Idea

Supabase Auth is the identity provider. It stores the actual auth account in `auth.users`, sends email verification links, sends commissioner invite links, sends password reset links, and performs phone OTP verification.

The app server owns the application session behavior. After Supabase returns a session, the server stores the Supabase access token and refresh token in HTTP-only cookies. React never stores those tokens directly.

The completed app-level user state is normally built from two places:

- Supabase Auth user: `auth.users`
- App profile row: `profiles`

During commissioner invitation onboarding, the backend also uses `pending_invites`
as temporary state. A matching `pending_invites.email` tells the backend that an
incomplete signed-in user should complete the commissioner profile flow instead
of the public profile flow. `pending_invites.invited_by` identifies the
commissioner who sent the invitation.

The profile row controls app role and profile fields:

- `role`: `public_user` or `commissioner`
- `first_name`
- `last_name`
- `province`
- `postal_code` for public users
- `phone` for public users
- `invited_by` for invited commissioners

`pending_invites` is not a permanent user profile source. After commissioner
onboarding succeeds, the backend copies `pending_invites.invited_by` into
`profiles.invited_by` and deletes the matching pending invite row.

Public profile completion is inferred from required fields: first name, last name, province, postal code, and phone. For app-created public users, 
**profiles row exists = public onboarding is completed.**

## Important Files

| Area | File | Responsibility |
| :--- | :--- | :--- |
| Express auth routes | `server/routes/auth.js` | Defines `/api/auth/*` endpoints and auth workflow decisions. |
| Supabase adapter | `server/lib/supabase.js` | Wraps Supabase Auth, profile queries, invites, and phone verification. |
| Cookies | `server/lib/cookies.js` | Reads, writes, and clears app session cookies. |
| Auth middleware | `server/middleware/requireAuth.js` | Validates cookies, refreshes sessions, loads profiles, and blocks incomplete public profiles. |
| Express app | `server/app.js` | Mounts auth routes at `/api/auth`, enables JSON parsing and credentialed CORS. |
| Frontend auth API | `src/services/authApi.js` | Sends browser requests to `/api/auth/*` with `credentials: "include"`. |
| Email-link Supabase client | `src/services/authLinkClient.js` | Handles invite and password reset links from Supabase in the browser. |
| Global auth state | `src/contexts/AuthContext.jsx` | Stores `user` and `sessionStatus` for React. |
| Route guards | `src/App.jsx` | Redirects signed-out, public, and commissioner users. |
| Sign in | `src/pages/SignInPage.jsx` | Calls login API and enters onboarding if needed. |
| Sign up | `src/pages/SignUpPage.jsx` | Calls signup API and sends users to email verification. |
| Onboarding state | `src/pages/auth/useAuthOnboarding.js` | Manages profile-required and OTP-required frontend states. |
| Onboarding UI | `src/pages/auth/AuthOnboarding.jsx` | Renders public profile, commissioner profile, and phone OTP screens. |
| Invite/password link page | `src/pages/auth/PasswordSetupPage.jsx` | Handles Supabase invite and password recovery links. |
| Commissioner profile | `src/pages/CommissionerProfile.jsx` | Sends commissioner invites and shows commissioner profile editing. |
| Public profile | `src/pages/UserProfile.jsx` | Edits public user profile and verifies changed phone numbers. |

## Cookies And Sessions

All auth cookies are HTTP-only. Frontend code cannot read them directly; requests include them through `fetch(..., { credentials: "include" })`.

Cookie helpers live in `server/lib/cookies.js`.

| Cookie | Purpose |
| :--- | :--- |
| `crmp_access_token` | Supabase access token for a completed app session. |
| `crmp_refresh_token` | Supabase refresh token for a completed app session. |
| `crmp_pending_access_token` | Supabase access token while profile onboarding is still incomplete. |
| `crmp_pending_refresh_token` | Supabase refresh token while profile onboarding is still incomplete. |
| `crmp_pending_profile` | Short-lived pending public onboarding profile data while phone OTP is not verified. |
| `crmp_pending_profile_update` | Short-lived pending public profile update data when a signed-in user changes phone. |

Cookie settings:

- `httpOnly: true`
- `path: "/"`
- `sameSite`: defaults to `lax`, configurable with `COOKIE_SAME_SITE`
- `secure`: true only in production
- access token max age: Supabase `expires_in` minus 30 seconds, minimum 60 seconds
- refresh token max age: 30 days
- pending profile data max age: 10 minutes

Session validation is in `server/middleware/requireAuth.js`.

For protected routes, `requireAuth`:

1. Reads `crmp_access_token` and `crmp_refresh_token`.
2. Calls `supabase.auth.getUser(accessToken)`.
3. If the access token is expired but refresh token exists, calls `supabase.auth.refreshSession(...)`.
4. Loads the app profile from `profiles`.
5. If the user is a public user and required fields are missing, moves the Supabase tokens into pending cookies and returns `403 Profile completion is required`.
6. Otherwise attaches `req.user`, `req.profile`, `req.accessToken`, and `req.refreshToken`.

Pending onboarding routes use `requirePendingProfileAuth`, which reads the pending cookies instead of the completed-session cookies.

## Supabase Usage

Supabase is used in two ways.

### Server-side Supabase Client

File: `server/lib/supabase.js`

The backend creates Supabase clients with:

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY` or `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` for admin-only operations

Normal user-scoped profile reads/writes use the user's Supabase access token:

- `getSupabaseProfile(accessToken, userId)`
- `updateSupabaseProfile(accessToken, userId, updates)`
- `upsertSupabaseProfile(accessToken, profile)`

Admin-only operations use the service-role key:

- Search existing auth users by email.
- Read pending invite rows.
- Insert/delete pending invite rows.
- Invite a commissioner by email.
- Delete a stale auth user left by an expired invite flow.
- Look up profile by phone for uniqueness checks.

### Frontend Email-Link Supabase Client

File: `src/services/authLinkClient.js`

This client is only for browser email-link flows:

- `/accept-invite`
- `/reset-password`

It uses:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY` or `VITE_SUPABASE_ANON_KEY`

It has:

- `detectSessionInUrl: true`
- `persistSession: false`

That means the browser can process the temporary Supabase session from the email link, update the password, then sign out. The main app session still goes through server cookies after the user signs in normally.

## Auth API Reference

All frontend calls go through `src/services/authApi.js`.

| Method | Route | Auth state | Purpose |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/auth/signup` | Public | Create a public auth account and send email verification. |
| `POST` | `/api/auth/login` | Public | Sign in with email/password and create either completed or pending cookies. |
| `POST` | `/api/auth/commissioner-invites` | Completed commissioner session | Send or resend a commissioner invitation. |
| `GET` | `/api/auth/profile-session` | Pending profile session | Restore an incomplete onboarding session. |
| `POST` | `/api/auth/profile` | Pending profile session | Complete commissioner profile or start public phone verification. |
| `POST` | `/api/auth/profile/phone-otp` | Pending profile session | Verify public onboarding phone OTP and save public profile. |
| `POST` | `/api/auth/password-reset` | Public | Send a Supabase password reset email. |
| `GET` | `/api/auth/me` | Completed session | Return the current app user. |
| `PATCH` | `/api/auth/me` | Completed session | Update commissioner profile, public profile, or start signed-in phone-change OTP. |
| `POST` | `/api/auth/me/phone-otp` | Completed public session | Verify changed phone number for a signed-in public user. |
| `POST` | `/api/auth/logout` | Any | Clear all app auth cookies. |

## User Object Returned To React

The server converts Supabase user + profile into a public app user object in `publicUser(...)` in `server/routes/auth.js`.

Shape:

```js
{
  id,
  email,
  emailVerified,
  firstName,
  lastName,
  name,
  phoneNumber,
  postalCode,
  profileComplete,
  province,
  role
}
```

`profileComplete` is a response field, not a database column. For public users it means required profile fields exist. For commissioners it is true after the commissioner profile exists.

## Workflow: Public Sign Up

Frontend:

- `src/pages/SignUpPage.jsx`
- `src/services/authApi.js`

Backend:

- `POST /api/auth/signup`
- `server/routes/auth.js`
- `server/lib/supabase.js`

Steps:

1. User enters email/password on `/sign-up`.
2. Frontend validates password length and confirmation.
3. Frontend calls `authApi.signup(...)`.
4. Backend checks whether an auth user already exists with `findSupabaseAuthUserByEmail(...)`.
5. If the account exists but email is not verified, backend resends a Supabase signup confirmation.
6. If the account exists and is verified, backend returns `409`.
7. If no account exists, backend calls Supabase `/auth/v1/signup` through `signUpSupabaseUser(...)`.
8. Supabase sends the email verification link.
9. User is redirected to sign in with a notice.

Related environment values:

- `SIGNUP_EMAIL_REDIRECT_URL`
- `CLIENT_ORIGIN`

If `SIGNUP_EMAIL_REDIRECT_URL` is not set, the backend builds a redirect to `/sign-in` from `CLIENT_ORIGIN`.

## Workflow: Email Verification

Frontend:

- `src/pages/SignInPage.jsx`

Steps:

1. User opens the Supabase verification link.
2. Supabase redirects to `/sign-in`.
3. `SignInPage` detects verification parameters in the URL.
4. It removes the parameters from browser history.
5. It shows a notice like "Email verified. Sign in to continue."

The app does not create app cookies during email verification. The user still signs in normally with email/password.

## Workflow: Login

Frontend:

- `src/pages/SignInPage.jsx`
- `src/pages/auth/useAuthOnboarding.js`
- `src/pages/auth/AuthOnboarding.jsx`

Backend:

- `POST /api/auth/login`
- `applySessionCookiesForUser(...)` in `server/routes/auth.js`

Steps:

1. User submits email/password on `/sign-in`.
2. Frontend calls `authApi.login(...)`.
3. Backend calls `supabase.auth.signInWithPassword(...)`.
4. If Supabase rejects the credentials, backend returns `401 Invalid email or password`.
5. If email is not confirmed, backend returns `403 Verify your email before signing in`.
6. If sign-in succeeds, backend loads `profiles`.
7. If the profile is complete, backend sets completed cookies:
   - `crmp_access_token`
   - `crmp_refresh_token`
8. If the profile is incomplete, backend clears completed cookies and sets pending cookies:
   - `crmp_pending_access_token`
   - `crmp_pending_refresh_token`
9. Backend returns either `{ user }` or `{ profileRequired: true, user, ...otpState }`.
10. Frontend either routes to role home or renders onboarding.

## Workflow: Public Onboarding

Frontend:

- `src/pages/auth/useAuthOnboarding.js`
- `src/pages/auth/AuthOnboarding.jsx`

Backend:

- `POST /api/auth/profile`
- `POST /api/auth/profile/phone-otp`

Steps:

1. A signed-in public user with no complete profile receives pending cookies and sees "Complete Profile".
2. User enters first name, last name, province, postal code, and phone.
3. Frontend calls `POST /api/auth/profile`.
4. Backend validates:
   - required fields
   - province code
   - Canadian postal code
   - Canadian phone number
   - phone uniqueness in `profiles`
5. Backend calls `startSupabasePhoneVerification(...)`.
6. Supabase sends the phone OTP.
7. Backend stores the submitted profile data in `crmp_pending_profile` for 10 minutes.
8. Backend returns `202 { otpRequired: true, phoneMasked }`.
9. Frontend shows the phone verification screen.
10. User enters OTP.
11. Frontend calls `POST /api/auth/profile/phone-otp`.
12. Backend verifies OTP with Supabase `verifyOtp({ type: "phone_change" })`.
13. Backend upserts the `profiles` row with first name, last name, province, postal code, phone, and role `public_user`.
14. Backend clears pending cookies, sets completed cookies, and returns `{ user }`.
15. Frontend stores the user in `AuthContext` and routes to public home.

Important behavior:

- The submitted public profile is not saved to `profiles` until phone OTP succeeds.
- The pending profile cookie is temporary and only supports the OTP step.
- If the user abandons onboarding, they may need to submit the profile form again after the pending cookie expires.

## Workflow: Commissioner Invite

Frontend:

- `src/pages/CommissionerProfile.jsx`

Backend:

- `POST /api/auth/commissioner-invites`
- `inviteSupabaseCommissioner(...)` in `server/lib/supabase.js`

Steps:

1. A signed-in commissioner opens `/dashboard/profile`.
2. Commissioner enters a colleague email and confirms the invite.
3. Frontend calls `authApi.inviteCommissioner(email)`.
4. Backend requires a completed commissioner session through `requireAuth`.
5. Backend rejects non-commissioner users.
6. Backend validates the email and blocks self-invites.
7. Backend checks `pending_invites`.
8. Backend checks whether an auth user already exists.
9. If no pending invite exists, backend inserts:

```text
pending_invites.email
pending_invites.invited_by
```

10. Backend calls `supabase.auth.admin.inviteUserByEmail(...)`.
11. Supabase emails an invite link that redirects to `/accept-invite`.

Reinvite behavior:

- If a pending invite exists from the same commissioner, the backend can resend.
- If the invite link was clicked and left a stale auth user with no app profile, the backend deletes that stale Supabase auth row before resending.
- If a profile already exists, the invite is treated as accepted and is not resent.
- If another commissioner owns the pending invite, the backend returns `409`.

The old direct commissioner signup page was removed. Commissioners must enter through the invite flow.

## Workflow: Accept Commissioner Invite

Frontend:

- `src/pages/AcceptInvitePage.jsx`
- `src/pages/auth/PasswordSetupPage.jsx`
- `src/services/authLinkClient.js`

Backend later involved:

- `POST /api/auth/login`
- `POST /api/auth/profile`

Steps:

1. Invited user opens the Supabase invite link.
2. Supabase redirects to `/accept-invite`.
3. `PasswordSetupPage` uses the email-link Supabase client to detect the temporary link session.
4. User creates a password with `authClient.auth.updateUser({ password })`.
5. The page signs out of the temporary Supabase browser session.
6. User is redirected to `/sign-in`.
7. User signs in normally.
8. Backend sees a pending invite for the user's email.
9. Backend returns `profileRequired: true` with role `commissioner`.
10. Frontend shows commissioner onboarding.
11. User enters first name, last name, and province.
12. Backend validates the pending invite and the inviter profile.
13. Backend upserts the commissioner profile:
    - email
    - first name
    - last name
    - province
    - role `commissioner`
    - invited_by
14. Backend deletes the matching `pending_invites` row.
15. Backend clears pending cookies, sets completed cookies, and returns `{ user }`.

Commissioner onboarding does not collect postal code or phone.

## Workflow: Password Reset

Frontend:

- `src/pages/ResetPasswordRequestPage.jsx`
- `src/pages/PasswordRecoveryPage.jsx`
- `src/pages/auth/PasswordSetupPage.jsx`

Backend:

- `POST /api/auth/password-reset`

Steps:

1. User opens `/forgot-password`.
2. User enters email.
3. Frontend calls `authApi.requestPasswordReset(...)`.
4. Backend calls `supabase.auth.resetPasswordForEmail(...)`.
5. Backend returns a generic success message even if the account does not exist.
6. User opens the Supabase reset email.
7. Supabase redirects to `/reset-password`.
8. `PasswordSetupPage` processes the temporary Supabase link session.
9. User enters a new password.
10. Frontend calls `authClient.auth.updateUser({ password })`.
11. Frontend signs out of the temporary Supabase browser session.
12. User is redirected to `/sign-in`.

Related environment value:

- `PASSWORD_RESET_REDIRECT_URL`

## Workflow: Restore Existing Session

Frontend:

- `src/contexts/AuthContext.jsx`
- `src/pages/auth/useAuthOnboarding.js`

Backend:

- `GET /api/auth/me`
- `GET /api/auth/profile-session`

Completed session:

1. `AuthProvider` runs on app load.
2. It calls `GET /api/auth/me`.
3. Backend `requireAuth` validates cookies and refreshes session if needed.
4. Backend returns `{ user }`.
5. React sets `sessionStatus: "signed-in"`.

Pending onboarding session:

1. Auth pages use `useAuthOnboarding`.
2. If no completed session exists, it calls `GET /api/auth/profile-session`.
3. Backend validates pending cookies.
4. Backend returns onboarding state if the profile is still incomplete.
5. Frontend renders either profile form or OTP screen.

## Workflow: Public Profile Edit

Frontend:

- `src/pages/UserProfile.jsx`

Backend:

- `PATCH /api/auth/me`
- `POST /api/auth/me/phone-otp`

Changing non-phone fields only:

1. Public user edits profile fields.
2. Frontend calls `PATCH /api/auth/me`.
3. Backend validates all public profile fields.
4. If phone is unchanged, backend updates all public profile fields.
5. Backend clears any pending profile update cookie.
6. Backend returns updated `{ user }`.

Changing phone plus other fields:

1. Public user edits phone and may also edit fields like postal code or province.
2. Frontend calls `PATCH /api/auth/me`.
3. Backend validates all public profile fields.
4. Backend checks phone uniqueness.
5. Backend immediately saves non-phone fields:
   - first name
   - last name
   - province
   - postal code
6. Backend keeps the old verified phone in `profiles`.
7. Backend starts Supabase phone verification for the new phone.
8. Backend stores the pending new phone and profile data in `crmp_pending_profile_update`.
9. Backend returns `202 { otpRequired: true, user, phoneMasked }`.
10. Frontend shows the OTP form below the success message.
11. User enters OTP.
12. Frontend calls `POST /api/auth/me/phone-otp`.
13. Backend verifies the phone-change OTP with Supabase.
14. Backend updates the profile with the new phone.
15. Backend clears `crmp_pending_profile_update`.

Security point:

- The client cannot directly save a new phone into `profiles`.
- The server only writes the new phone after Supabase verifies the OTP.
- The server builds the profile update payload itself; client-submitted fields like `role` are ignored.

## Workflow: Commissioner Profile Edit

Frontend:

- `src/components/non_prebuilt/CommissionerInformationForm.jsx`
- `src/pages/CommissionerProfile.jsx`

Backend:

- `PATCH /api/auth/me`

Steps:

1. Commissioner edits first name or last name.
2. Frontend calls `authApi.updateCommissionerProfile(...)`.
3. Backend checks `req.profile.role === "commissioner"`.
4. Backend validates first and last name.
5. Backend updates only `first_name` and `last_name`.
6. Backend returns updated `{ user }`.

Commissioner province is displayed read-only in the profile form.

## Workflow: Logout

Frontend:

- `src/components/non_prebuilt/ProfileSignOutButton.jsx`
- `src/contexts/AuthContext.jsx`

Backend:

- `POST /api/auth/logout`

Steps:

1. User clicks Sign Out.
2. Frontend calls `authApi.logout()`.
3. Backend clears:
   - completed auth cookies
   - pending onboarding cookies
   - pending profile update cookie
4. Backend returns `204`.
5. Frontend clears `AuthContext` and navigates to `/sign-in`.

## Route Guards

File: `src/App.jsx`

`RequirePublicUser`:

- Waits while auth state is checking.
- Redirects signed-out users to `/sign-in`.
- Redirects commissioners to `/dashboard/profile`.
- Allows public users through.

`RequireCommissioner`:

- Waits while auth state is checking.
- Redirects signed-out users to `/sign-in`.
- Redirects non-commissioners to `/users`.
- Allows commissioners through.

Server-side route guards are still the source of truth. Frontend guards are for navigation and user experience.

## Error Cases And User-Facing Messages

Common examples:

| Case | Where handled | Response/message |
| :--- | :--- | :--- |
| Wrong email/password | `POST /api/auth/login` | `Invalid email or password.` |
| Email not verified | `POST /api/auth/login` | `Verify your email before signing in.` |
| Existing verified signup email | `POST /api/auth/signup` | `An account with this email already exists. Please sign in.` |
| Existing unverified signup email | `POST /api/auth/signup` | Resends verification email. |
| Public user missing profile | `requireAuth` | Moves session to pending cookies and returns profile completion required. |
| Duplicate phone | Profile endpoints | `This phone number is already linked to another account.` |
| Non-commissioner invite attempt | `POST /api/auth/commissioner-invites` | `Only commissioners can invite a new commissioner.` |
| Expired/invalid invite link | `PasswordSetupPage` | Asks user to request a new invitation. |

## Why There Are Completed And Pending Cookies

The app separates "Supabase knows who this is" from "this person can enter the app."

A user can have a valid Supabase session but still be missing required app profile data. In that case:

- completed cookies are cleared
- pending cookies are set
- only onboarding endpoints are allowed

Once onboarding succeeds:

- pending cookies are cleared
- completed cookies are set
- the user can access app routes

This avoids treating a verified email/password account as a fully onboarded app user.

## Current Auth Rules Summary

- Public users sign up directly.
- Public users must verify email before login.
- Public users must complete profile and verify phone before entering the app.
- Commissioners cannot self-register through a public page.
- Commissioners are invited by an existing commissioner.
- Invited commissioners create a password through Supabase invite link, then complete commissioner onboarding after normal sign-in.
- Commissioner onboarding collects first name, last name, and province only.
- Commissioner profile editing allows first and last name only.
- Public profile phone changes require OTP before the new phone is saved.
- Public profile non-phone changes can save immediately, even when a phone change is pending verification.
