const transientStatuses = new Set([502, 503, 504]);

function wait(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function isTransientRequestError(error) {
  return error.name === "TypeError" || transientStatuses.has(error.status);
}

async function request(path, options = {}) {
  let response;

  try {
    response = await fetch(path, {
      credentials: "include",
      ...options,
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers
      }
    });
  } catch (networkError) {
    networkError.status = 0;
    throw networkError;
  }

  if (response.status === 204) {
    return null;
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(
      data.error ||
        (transientStatuses.has(response.status)
          ? "Server is still starting. Please try again."
          : "Request failed.")
    );
    error.status = response.status;
    throw error;
  }

  return data;
}

async function requestWithTransientRetry(path, options = {}) {
  try {
    return await request(path, options);
  } catch (error) {
    if (!isTransientRequestError(error)) {
      throw error;
    }

    await wait(500);
    return request(path, options);
  }
}

export const authApi = {
  getCurrentUser() {
    return request("/api/auth/me");
  },
  updateCommissionerProfile(profile) {
    return request("/api/auth/me", {
      method: "PATCH",
      body: JSON.stringify(profile)
    });
  },
  inviteCommissioner(email) {
    return request("/api/auth/commissioner-invites", {
      method: "POST",
      body: JSON.stringify({ email })
    });
  },
  getPendingProfileSession() {
    return request("/api/auth/profile-session");
  },
  login(credentials) {
    return requestWithTransientRetry("/api/auth/login", {
      method: "POST",
      body: JSON.stringify(credentials)
    });
  },
  signup({ email, password }) {
    return request("/api/auth/signup", {
      method: "POST",
      body: JSON.stringify({ email, password })
    });
  },
  commissionerSignup(account) {
    return request("/api/auth/commissioner-signup", {
      method: "POST",
      body: JSON.stringify(account)
    });
  },
  completeProfile(profile) {
    return request("/api/auth/profile", {
      method: "POST",
      body: JSON.stringify(profile)
    });
  },
  verifyProfileOtp({ token }) {
    return request("/api/auth/profile/phone-otp", {
      method: "POST",
      body: JSON.stringify({ token })
    });
  },
  requestPasswordReset({ email }) {
    return request("/api/auth/password-reset", {
      method: "POST",
      body: JSON.stringify({ email })
    });
  },
  logout() {
    return request("/api/auth/logout", {
      method: "POST"
    });
  }
};
