import { LogIn, LogOut, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { authApi } from "./services/authApi.js";

const initialForm = {
  email: "",
  password: ""
};

function App() {
  const [form, setForm] = useState(initialForm);
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState("checking");
  const [error, setError] = useState("");

  const initials = useMemo(() => {
    const source = user?.name || user?.email || "";
    return source
      .split(/[.@\s_-]/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("");
  }, [user]);

  useEffect(() => {
    let isMounted = true;

    authApi
      .getCurrentUser()
      .then(({ user: currentUser }) => {
        if (isMounted) {
          setUser(currentUser);
          setStatus("signed-in");
        }
      })
      .catch(() => {
        if (isMounted) {
          setStatus("signed-out");
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  function handleChange(event) {
    const { name, value } = event.target;
    setForm((currentForm) => ({ ...currentForm, [name]: value }));
    setError("");
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setStatus("submitting");
    setError("");

    try {
      const { user: signedInUser } = await authApi.login(form);
      setUser(signedInUser);
      setForm(initialForm);
      setStatus("signed-in");
    } catch (loginError) {
      setError(loginError.message);
      setStatus("signed-out");
    }
  }

  async function handleLogout() {
    setStatus("submitting");
    setError("");

    try {
      await authApi.logout();
      setUser(null);
      setStatus("signed-out");
    } catch (logoutError) {
      setError(logoutError.message);
      setStatus(user ? "signed-in" : "signed-out");
    }
  }

  if (status === "checking") {
    return (
      <main className="screen-center">
        <div className="loading-mark" aria-label="Loading session" />
      </main>
    );
  }

  if (user) {
    return (
      <main className="dashboard-shell">
        <header className="dashboard-header">
          <div className="brand-lockup">
            <div>
              <p className="eyebrow">CRMP</p>
              <h1>Commissioner Dashboard</h1>
            </div>
          </div>
          <button
            className="ghost-button"
            onClick={handleLogout}
            disabled={status === "submitting"}
            type="button"
          >
            <LogOut aria-hidden="true" size={18} />
            <span>{status === "submitting" ? "Signing out" : "Sign out"}</span>
          </button>
        </header>

        <section className="workspace-grid" aria-label="Dashboard">
          <div className="profile-panel">
            <div className="avatar" aria-hidden="true">
              {initials || "C"}
            </div>
            <div>
              <p className="panel-label">Signed in as</p>
              <h2>{user.name || user.email}</h2>
              <p>{user.email}</p>
              <span className="role-pill">{user.role}</span>
            </div>
          </div>

          <div className="status-panel">
            <ShieldCheck aria-hidden="true" size={28} />
            <div>
              <p className="panel-label">Session</p>
              <h2>Authenticated</h2>
              <p>Protected API calls can now use the HttpOnly session cookie.</p>
            </div>
          </div>
        </section>

        {error ? <p className="form-error">{error}</p> : null}
      </main>
    );
  }

  return (
    <main className="auth-shell">
      <section className="auth-layout" aria-label="Commissioner sign in">
        <div className="login-panel">
          <div className="brand-lockup">
            <div>
              <h1>Sign In</h1>
            </div>
          </div>

          <form className="login-form" onSubmit={handleSubmit}>
            <label htmlFor="email">Email</label>
            <input
              autoComplete="email"
              id="email"
              name="email"
              onChange={handleChange}
              required
              type="email"
              value={form.email}
            />

            <label htmlFor="password">Password</label>
            <input
              autoComplete="current-password"
              id="password"
              name="password"
              onChange={handleChange}
              required
              type="password"
              value={form.password}
            />

            {error ? <p className="form-error">{error}</p> : null}

            <button
              className="primary-button"
              disabled={status === "submitting"}
              type="submit"
            >
              <LogIn aria-hidden="true" size={19} />
              <span>{status === "submitting" ? "Signing in" : "Sign in"}</span>
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}

export default App;
