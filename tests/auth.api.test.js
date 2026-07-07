import assert from "node:assert/strict";
import http from "node:http";
import { afterEach, test } from "node:test";

import app from "../server/app.js";
import { setSupabaseTestDoubles } from "../server/lib/supabase.js";

const testUser = {
  email: "person@example.com",
  email_confirmed_at: "2026-07-07T12:00:00.000Z",
  id: "user-1"
};

const completePublicProfile = {
  created_at: "2026-07-07T12:01:00.000Z",
  email: testUser.email,
  first_name: "Ada",
  id: testUser.id,
  invited_by: null,
  last_name: "Lovelace",
  phone: "4165550100",
  postal_code: "K1A 0B1",
  province: "ON",
  role: "public_user"
};

afterEach(() => {
  setSupabaseTestDoubles(null);
});

function sessionCookies() {
  return "crmp_access_token=access-token; crmp_refresh_token=refresh-token";
}

function pendingProfileUpdateCookie(profile) {
  return `crmp_pending_profile_update=${encodeURIComponent(
    JSON.stringify(profile)
  )}`;
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

function authenticatedSupabaseDouble(user = testUser) {
  return {
    auth: {
      getUser: async (accessToken) => {
        assert.equal(accessToken, "access-token");

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
            user: testUser
          },
          error: null
        })
      }
    }),
    getSupabaseProfile: async (accessToken, userId) => {
      assert.equal(accessToken, "access-token");
      assert.equal(userId, testUser.id);

      return completePublicProfile;
    }
  });

  const response = await request("POST", "/api/auth/login", {
    body: {
      email: testUser.email,
      password: "correct-password"
    }
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.user.email, testUser.email);
  assert.equal(response.body.user.name, "Ada Lovelace");
  assert.equal(response.body.user.profileComplete, true);
  assert.equal(response.body.user.role, "public_user");
  assert.match(response.setCookie, /crmp_access_token=access-token/);
  assert.match(response.setCookie, /crmp_refresh_token=refresh-token/);
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
      userId: testUser.id,
      updates: {
        email: testUser.email,
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
      userId: testUser.id,
      updates: {
        email: testUser.email,
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
