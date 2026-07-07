import assert from "node:assert/strict";
import http from "node:http";
import { afterEach, test } from "@jest/globals";

import app from "../server/app.js";
import { setSupabaseTestDoubles } from "../server/lib/supabase.js";

const publicUser = {
  email: "person@example.com",
  email_confirmed_at: "2026-07-07T12:00:00.000Z",
  id: "user-1"
};

const commissionerUser = {
  email: "commissioner@example.com",
  email_confirmed_at: "2026-07-07T12:00:00.000Z",
  id: "commissioner-1"
};

const completePublicProfile = {
  created_at: "2026-07-07T12:01:00.000Z",
  email: publicUser.email,
  first_name: "Ada",
  id: publicUser.id,
  invited_by: null,
  last_name: "Lovelace",
  phone: "4165550100",
  postal_code: "K1A 0B1",
  province: "ON",
  role: "public_user"
};

const commissionerProfile = {
  created_at: "2026-07-07T12:01:00.000Z",
  email: commissionerUser.email,
  first_name: "Grace",
  id: commissionerUser.id,
  invited_by: null,
  last_name: "Hopper",
  phone: null,
  postal_code: null,
  province: "BC",
  role: "commissioner"
};

const incompletePublicProfile = {
  ...completePublicProfile,
  phone: null
};

afterEach(() => {
  setSupabaseTestDoubles(null);
});

function sessionCookies(accessToken = "access-token", refreshToken = "refresh-token") {
  return `crmp_access_token=${accessToken}; crmp_refresh_token=${refreshToken}`;
}

function pendingSessionCookies(
  accessToken = "pending-access-token",
  refreshToken = "pending-refresh-token"
) {
  return `crmp_pending_access_token=${accessToken}; crmp_pending_refresh_token=${refreshToken}`;
}

function jsonCookie(name, value) {
  return `${name}=${encodeURIComponent(JSON.stringify(value))}`;
}

function pendingProfileCookie(profile) {
  return jsonCookie("crmp_pending_profile", profile);
}

function pendingProfileUpdateCookie(profile) {
  return jsonCookie("crmp_pending_profile_update", profile);
}

async function withTestServer(callback) {
  const server = http.createServer(app);

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    return await callback(baseUrl);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }
}

async function request(method, path, options = {}) {
  return withTestServer(async (baseUrl) => {
    const headers = {};

    if (options.body) {
      headers["Content-Type"] = "application/json";
    }

    if (options.cookie) {
      headers.cookie = options.cookie;
    }

    const response = await fetch(`${baseUrl}${path}`, {
      body: options.body ? JSON.stringify(options.body) : undefined,
      headers,
      method
    });
    const text = await response.text();

    return {
      body: text ? JSON.parse(text) : null,
      setCookie: response.headers.get("set-cookie") || "",
      status: response.status
    };
  });
}

function authenticatedSupabaseDouble({
  expectedAccessToken = "access-token",
  user = publicUser
} = {}) {
  return {
    auth: {
      getUser: async (accessToken) => {
        assert.equal(accessToken, expectedAccessToken);

        return {
          data: { user },
          error: null
        };
      },
      refreshSession: async () => {
        assert.fail("The test access token should not need to be refreshed.");
      }
    }
  };
}

test("POST /api/auth/signup creates a new account", async () => {
  const createdAccounts = [];

  setSupabaseTestDoubles({
    findSupabaseAuthUserByEmail: async () => null,
    signUpSupabaseUser: async (account) => {
      createdAccounts.push(account);

      return {};
    }
  });

  const response = await request("POST", "/api/auth/signup", {
    body: {
      email: " NEW@Example.COM ",
      password: "password123"
    }
  });

  assert.equal(response.status, 201);
  assert.equal(
    response.body.message,
    "Account created. Check your email to verify your address before signing in."
  );
  assert.deepEqual(createdAccounts, [
    {
      email: "new@example.com",
      emailRedirectTo: undefined,
      password: "password123"
    }
  ]);
});

test("POST /api/auth/signup resends verification for an unverified existing user", async () => {
  const resentEmails = [];

  setSupabaseTestDoubles({
    findSupabaseAuthUserByEmail: async (email) => ({
      email,
      email_confirmed_at: null,
      id: "unverified-user"
    }),
    resendSupabaseSignupConfirmation: async (requestBody) => {
      resentEmails.push(requestBody);

      return {};
    }
  });

  const response = await request("POST", "/api/auth/signup", {
    body: {
      email: "pending@example.com",
      password: "password123"
    }
  });

  assert.equal(response.status, 200);
  assert.equal(
    response.body.message,
    "A verification email was already pending. We sent a new verification link to your email."
  );
  assert.deepEqual(resentEmails, [
    {
      email: "pending@example.com",
      emailRedirectTo: undefined
    }
  ]);
});

test("POST /api/auth/signup rejects a verified existing user", async () => {
  setSupabaseTestDoubles({
    findSupabaseAuthUserByEmail: async (email) => ({
      email,
      email_confirmed_at: "2026-07-07T12:00:00.000Z",
      id: "verified-user"
    })
  });

  const response = await request("POST", "/api/auth/signup", {
    body: {
      email: "person@example.com",
      password: "password123"
    }
  });

  assert.equal(response.status, 409);
  assert.deepEqual(response.body, {
    error: "An account with this email already exists. Please sign in."
  });
});

test("POST /api/auth/login returns a generic error for invalid credentials", async () => {
  const credentials = [];

  setSupabaseTestDoubles({
    getSupabaseClient: () => ({
      auth: {
        signInWithPassword: async (submittedCredentials) => {
          credentials.push(submittedCredentials);

          return {
            data: null,
            error: { message: "Invalid login credentials" }
          };
        }
      }
    })
  });

  const response = await request("POST", "/api/auth/login", {
    body: {
      email: " PERSON@Example.COM ",
      password: "incorrect-password"
    }
  });

  assert.equal(response.status, 401);
  assert.deepEqual(response.body, { error: "Invalid email or password." });
  assert.deepEqual(credentials, [
    {
      email: "person@example.com",
      password: "incorrect-password"
    }
  ]);
});

test("POST /api/auth/login returns the app user and session cookies", async () => {
  setSupabaseTestDoubles({
    getSupabaseClient: () => ({
      auth: {
        signInWithPassword: async () => ({
          data: {
            session: {
              access_token: "access-token",
              expires_in: 3600,
              refresh_token: "refresh-token"
            },
            user: publicUser
          },
          error: null
        })
      }
    }),
    getSupabaseProfile: async (accessToken, userId) => {
      assert.equal(accessToken, "access-token");
      assert.equal(userId, publicUser.id);

      return completePublicProfile;
    }
  });

  const response = await request("POST", "/api/auth/login", {
    body: {
      email: publicUser.email,
      password: "correct-password"
    }
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.user.email, publicUser.email);
  assert.equal(response.body.user.name, "Ada Lovelace");
  assert.equal(response.body.user.profileComplete, true);
  assert.equal(response.body.user.role, "public_user");
  assert.match(response.setCookie, /crmp_access_token=access-token/);
  assert.match(response.setCookie, /crmp_refresh_token=refresh-token/);
});

test("POST /api/auth/commissioner-invites sends an invite for commissioners", async () => {
  const invitations = [];

  setSupabaseTestDoubles({
    getSupabaseClient: () =>
      authenticatedSupabaseDouble({ user: commissionerUser }),
    getSupabaseProfile: async () => commissionerProfile,
    inviteSupabaseCommissioner: async (invite) => {
      invitations.push(invite);

      return { resent: false };
    }
  });

  const response = await request("POST", "/api/auth/commissioner-invites", {
    body: {
      email: " NEW-COMMISSIONER@Example.COM "
    },
    cookie: sessionCookies()
  });

  assert.equal(response.status, 201);
  assert.deepEqual(response.body, {
    message: "Invitation sent to new-commissioner@example.com."
  });
  assert.equal(invitations.length, 1);
  assert.equal(invitations[0].email, "new-commissioner@example.com");
  assert.equal(invitations[0].invitedBy, commissionerUser.id);
});

test("POST /api/auth/commissioner-invites rejects public users", async () => {
  setSupabaseTestDoubles({
    getSupabaseClient: () => authenticatedSupabaseDouble(),
    getSupabaseProfile: async () => completePublicProfile
  });

  const response = await request("POST", "/api/auth/commissioner-invites", {
    body: {
      email: "new-commissioner@example.com"
    },
    cookie: sessionCookies()
  });

  assert.equal(response.status, 403);
  assert.deepEqual(response.body, {
    error: "Only commissioners can invite a new commissioner."
  });
});

test("GET /api/auth/profile-session returns pending onboarding state", async () => {
  const pendingProfile = {
    firstName: "Ada",
    lastName: "Lovelace",
    phoneAuth: "14165550100",
    phoneNational: "4165550100",
    phoneNumber: "+14165550100",
    postalCode: "K1A 0B1",
    province: "ON"
  };

  setSupabaseTestDoubles({
    getPendingCommissionerInvite: async () => null,
    getSupabaseClient: () =>
      authenticatedSupabaseDouble({
        expectedAccessToken: "pending-access-token"
      }),
    getSupabaseProfile: async () => incompletePublicProfile
  });

  const response = await request("GET", "/api/auth/profile-session", {
    cookie: `${pendingSessionCookies()}; ${pendingProfileCookie(pendingProfile)}`
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.profileRequired, true);
  assert.equal(response.body.otpRequired, true);
  assert.equal(response.body.phoneMasked, "***-***-0100");
  assert.equal(response.body.user.profileComplete, false);
});

test("POST /api/auth/profile starts public onboarding phone verification", async () => {
  const phoneLookups = [];
  const verificationStarts = [];

  setSupabaseTestDoubles({
    findSupabaseProfileByPhone: async (phone) => {
      phoneLookups.push(phone);

      return null;
    },
    getPendingCommissionerInvite: async () => null,
    getSupabaseClient: () =>
      authenticatedSupabaseDouble({
        expectedAccessToken: "pending-access-token"
      }),
    startSupabasePhoneVerification: async (accessToken, phone) => {
      verificationStarts.push({ accessToken, phone });

      return {};
    }
  });

  const response = await request("POST", "/api/auth/profile", {
    body: {
      firstName: "Ada",
      lastName: "Lovelace",
      phoneNumber: "416-555-0100",
      postalCode: "K1A0B1",
      province: "ON"
    },
    cookie: pendingSessionCookies()
  });

  assert.equal(response.status, 202);
  assert.equal(response.body.message, "Verification code sent.");
  assert.equal(response.body.otpRequired, true);
  assert.equal(response.body.phoneMasked, "***-***-0100");
  assert.deepEqual(phoneLookups, ["4165550100"]);
  assert.deepEqual(verificationStarts, [
    {
      accessToken: "pending-access-token",
      phone: "14165550100"
    }
  ]);
  assert.match(response.setCookie, /crmp_pending_profile=/);
});

test("POST /api/auth/profile completes commissioner onboarding", async () => {
  const consumedInvites = [];
  const upserts = [];

  setSupabaseTestDoubles({
    consumePendingCommissionerInvite: async (email, invitedBy) => {
      consumedInvites.push({ email, invitedBy });

      return true;
    },
    getPendingCommissionerInvite: async (email) => ({
      email,
      invited_by: commissionerUser.id
    }),
    getSupabaseClient: () =>
      authenticatedSupabaseDouble({
        expectedAccessToken: "pending-access-token",
        user: publicUser
      }),
    getSupabaseProfileAsAdmin: async (userId) => {
      assert.equal(userId, commissionerUser.id);

      return commissionerProfile;
    },
    upsertSupabaseProfile: async (accessToken, profile) => {
      upserts.push({ accessToken, profile });

      return {
        ...commissionerProfile,
        ...profile
      };
    }
  });

  const response = await request("POST", "/api/auth/profile", {
    body: {
      firstName: "Katherine",
      lastName: "Johnson",
      province: "ON"
    },
    cookie: pendingSessionCookies()
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.message, "Commissioner profile completed.");
  assert.equal(response.body.user.role, "commissioner");
  assert.deepEqual(upserts, [
    {
      accessToken: "pending-access-token",
      profile: {
        email: publicUser.email,
        first_name: "Katherine",
        id: publicUser.id,
        invited_by: commissionerUser.id,
        last_name: "Johnson",
        province: "ON",
        role: "commissioner"
      }
    }
  ]);
  assert.deepEqual(consumedInvites, [
    {
      email: publicUser.email,
      invitedBy: commissionerUser.id
    }
  ]);
  assert.match(response.setCookie, /crmp_access_token=pending-access-token/);
});

test("POST /api/auth/profile/phone-otp completes public onboarding", async () => {
  const phoneLookups = [];
  const phoneVerifications = [];
  const upserts = [];
  const pendingProfile = {
    firstName: "Ada",
    lastName: "Lovelace",
    phoneAuth: "14165550100",
    phoneNational: "4165550100",
    phoneNumber: "+14165550100",
    postalCode: "K1A 0B1",
    province: "ON"
  };

  setSupabaseTestDoubles({
    findSupabaseProfileByPhone: async (phone) => {
      phoneLookups.push(phone);

      return null;
    },
    getPendingCommissionerInvite: async () => null,
    getSupabaseClient: () =>
      authenticatedSupabaseDouble({
        expectedAccessToken: "pending-access-token"
      }),
    getSupabaseProfile: async () => null,
    upsertSupabaseProfile: async (accessToken, profile) => {
      upserts.push({ accessToken, profile });

      return {
        ...completePublicProfile,
        ...profile
      };
    },
    verifySupabasePhoneChange: async (accessToken, phone, token) => {
      phoneVerifications.push({ accessToken, phone, token });

      return {};
    }
  });

  const response = await request("POST", "/api/auth/profile/phone-otp", {
    body: { token: "123 456" },
    cookie: `${pendingSessionCookies()}; ${pendingProfileCookie(pendingProfile)}`
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.user.profileComplete, true);
  assert.deepEqual(phoneLookups, ["4165550100"]);
  assert.deepEqual(phoneVerifications, [
    {
      accessToken: "pending-access-token",
      phone: "14165550100",
      token: "123456"
    }
  ]);
  assert.deepEqual(upserts, [
    {
      accessToken: "pending-access-token",
      profile: {
        email: publicUser.email,
        first_name: "Ada",
        id: publicUser.id,
        invited_by: null,
        last_name: "Lovelace",
        phone: "4165550100",
        postal_code: "K1A 0B1",
        province: "ON",
        role: "public_user"
      }
    }
  ]);
  assert.match(response.setCookie, /crmp_access_token=pending-access-token/);
});

test("POST /api/auth/password-reset sends a reset email", async () => {
  const resetRequests = [];

  setSupabaseTestDoubles({
    getSupabaseClient: () => ({
      auth: {
        resetPasswordForEmail: async (email, options) => {
          resetRequests.push({ email, options });

          return { error: null };
        }
      }
    })
  });

  const response = await request("POST", "/api/auth/password-reset", {
    body: {
      email: " PERSON@Example.COM "
    }
  });

  assert.equal(response.status, 200);
  assert.equal(
    response.body.message,
    "If an account exists for that email, a password reset link has been sent."
  );
  assert.deepEqual(resetRequests, [
    {
      email: "person@example.com",
      options: undefined
    }
  ]);
});

test("GET /api/auth/me returns the current authenticated user", async () => {
  setSupabaseTestDoubles({
    getSupabaseClient: () => authenticatedSupabaseDouble(),
    getSupabaseProfile: async () => completePublicProfile
  });

  const response = await request("GET", "/api/auth/me", {
    cookie: sessionCookies()
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.user.email, publicUser.email);
  assert.equal(response.body.user.profileComplete, true);
});

test("PATCH /api/auth/me updates public profile when the phone is unchanged", async () => {
  const phoneLookups = [];
  const profileUpdates = [];

  setSupabaseTestDoubles({
    findSupabaseProfileByPhone: async (phone) => {
      phoneLookups.push(phone);

      return null;
    },
    getSupabaseClient: () => authenticatedSupabaseDouble(),
    getSupabaseProfile: async () => completePublicProfile,
    updateSupabaseProfile: async (accessToken, userId, updates) => {
      profileUpdates.push({ accessToken, updates, userId });

      return {
        ...completePublicProfile,
        ...updates
      };
    }
  });

  const response = await request("PATCH", "/api/auth/me", {
    body: {
      firstName: "Ada",
      lastName: "Byron",
      phoneNumber: "416-555-0100",
      postalCode: "V6B1A1",
      province: "BC"
    },
    cookie: sessionCookies()
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.message, "Profile information updated.");
  assert.equal(response.body.user.lastName, "Byron");
  assert.equal(response.body.user.phoneNumber, "4165550100");
  assert.deepEqual(phoneLookups, ["4165550100"]);
  assert.deepEqual(profileUpdates, [
    {
      accessToken: "access-token",
      userId: publicUser.id,
      updates: {
        email: publicUser.email,
        first_name: "Ada",
        last_name: "Byron",
        phone: "4165550100",
        postal_code: "V6B 1A1",
        province: "BC",
        role: "public_user"
      }
    }
  ]);
  assert.match(response.setCookie, /crmp_pending_profile_update=;/);
});

test("PATCH /api/auth/me saves non-phone profile fields before phone OTP succeeds", async () => {
  const phoneLookups = [];
  const profileUpdates = [];
  const phoneVerificationStarts = [];

  setSupabaseTestDoubles({
    findSupabaseProfileByPhone: async (phone) => {
      phoneLookups.push(phone);

      return null;
    },
    getSupabaseClient: () => authenticatedSupabaseDouble(),
    getSupabaseProfile: async () => completePublicProfile,
    startSupabasePhoneVerification: async (accessToken, phone) => {
      phoneVerificationStarts.push({ accessToken, phone });

      return {};
    },
    updateSupabaseProfile: async (accessToken, userId, updates) => {
      profileUpdates.push({ accessToken, updates, userId });

      return {
        ...completePublicProfile,
        ...updates
      };
    }
  });

  const response = await request("PATCH", "/api/auth/me", {
    body: {
      firstName: "Ada",
      lastName: "Byron",
      phoneNumber: "647-555-1212",
      postalCode: "V6B1A1",
      province: "BC"
    },
    cookie: sessionCookies()
  });

  assert.equal(response.status, 202);
  assert.equal(
    response.body.message,
    "Profile information saved. Verification code sent."
  );
  assert.equal(response.body.otpRequired, true);
  assert.equal(response.body.phoneMasked, "***-***-1212");
  assert.equal(response.body.user.lastName, "Byron");
  assert.equal(response.body.user.postalCode, "V6B 1A1");
  assert.equal(response.body.user.phoneNumber, "4165550100");
  assert.deepEqual(phoneLookups, ["6475551212"]);
  assert.deepEqual(profileUpdates, [
    {
      accessToken: "access-token",
      userId: publicUser.id,
      updates: {
        email: publicUser.email,
        first_name: "Ada",
        last_name: "Byron",
        postal_code: "V6B 1A1",
        province: "BC",
        role: "public_user"
      }
    }
  ]);
  assert.deepEqual(phoneVerificationStarts, [
    {
      accessToken: "access-token",
      phone: "16475551212"
    }
  ]);
  assert.match(response.setCookie, /crmp_pending_profile_update=/);
});

test("PATCH /api/auth/me updates commissioner profile fields", async () => {
  const profileUpdates = [];

  setSupabaseTestDoubles({
    getSupabaseClient: () =>
      authenticatedSupabaseDouble({ user: commissionerUser }),
    getSupabaseProfile: async () => commissionerProfile,
    updateSupabaseProfile: async (accessToken, userId, updates) => {
      profileUpdates.push({ accessToken, updates, userId });

      return {
        ...commissionerProfile,
        ...updates
      };
    }
  });

  const response = await request("PATCH", "/api/auth/me", {
    body: {
      firstName: "Amazing",
      lastName: "Grace"
    },
    cookie: sessionCookies()
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.message, "Profile information updated.");
  assert.equal(response.body.user.name, "Amazing Grace");
  assert.deepEqual(profileUpdates, [
    {
      accessToken: "access-token",
      userId: commissionerUser.id,
      updates: {
        first_name: "Amazing",
        last_name: "Grace"
      }
    }
  ]);
});

test("POST /api/auth/me/phone-otp saves the pending phone after OTP verification", async () => {
  const phoneLookups = [];
  const phoneVerifications = [];
  const profileUpdates = [];
  const pendingProfile = {
    firstName: "Ada",
    lastName: "Byron",
    phoneAuth: "16475551212",
    phoneNational: "6475551212",
    phoneNumber: "+16475551212",
    postalCode: "V6B 1A1",
    province: "BC"
  };

  setSupabaseTestDoubles({
    findSupabaseProfileByPhone: async (phone) => {
      phoneLookups.push(phone);

      return null;
    },
    getSupabaseClient: () => authenticatedSupabaseDouble(),
    getSupabaseProfile: async () => completePublicProfile,
    updateSupabaseProfile: async (accessToken, userId, updates) => {
      profileUpdates.push({ accessToken, updates, userId });

      return {
        ...completePublicProfile,
        ...updates
      };
    },
    verifySupabasePhoneChange: async (accessToken, phone, token) => {
      phoneVerifications.push({ accessToken, phone, token });

      return {};
    }
  });

  const response = await request("POST", "/api/auth/me/phone-otp", {
    body: { token: "123 456" },
    cookie: `${sessionCookies()}; ${pendingProfileUpdateCookie(pendingProfile)}`
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.message, "Profile information updated.");
  assert.equal(response.body.user.phoneNumber, "6475551212");
  assert.deepEqual(phoneLookups, ["6475551212"]);
  assert.deepEqual(phoneVerifications, [
    {
      accessToken: "access-token",
      phone: "16475551212",
      token: "123456"
    }
  ]);
  assert.deepEqual(profileUpdates, [
    {
      accessToken: "access-token",
      userId: publicUser.id,
      updates: {
        email: publicUser.email,
        first_name: "Ada",
        last_name: "Byron",
        phone: "6475551212",
        postal_code: "V6B 1A1",
        province: "BC",
        role: "public_user"
      }
    }
  ]);
  assert.match(response.setCookie, /crmp_pending_profile_update=;/);
});

test("POST /api/auth/logout clears auth cookies", async () => {
  const response = await request("POST", "/api/auth/logout");

  assert.equal(response.status, 204);
  assert.equal(response.body, null);
  assert.match(response.setCookie, /crmp_access_token=;/);
  assert.match(response.setCookie, /crmp_refresh_token=;/);
  assert.match(response.setCookie, /crmp_pending_access_token=;/);
  assert.match(response.setCookie, /crmp_pending_refresh_token=;/);
  assert.match(response.setCookie, /crmp_pending_profile=;/);
  assert.match(response.setCookie, /crmp_pending_profile_update=;/);
});
