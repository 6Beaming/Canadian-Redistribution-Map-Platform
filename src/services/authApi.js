async function request(path, options = {}) {
  const response = await fetch(path, {
    credentials: "include",
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers
    }
  });

  if (response.status === 204) {
    return null;
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || "Request failed.");
  }

  return data;
}

export const authApi = {
  getCurrentUser() {
    return request("/api/auth/me");
  },
  login(credentials) {
    return request("/api/auth/login", {
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
  completeProfile(profile) {
    return request("/api/auth/profile", {
      method: "POST",
      body: JSON.stringify(profile)
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
