import { UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { authApi } from "../services/authApi.js";
import AuthPanel from "./auth/AuthPanel.jsx";

const initialCommissionerForm = {
  confirmPassword: "",
  email: "",
  firstName: "",
  lastName: "",
  password: "",
  province: ""
};

const provinces = [
  ["AB", "Alberta"],
  ["BC", "British Columbia"],
  ["MB", "Manitoba"],
  ["NB", "New Brunswick"],
  ["NL", "Newfoundland and Labrador"],
  ["NS", "Nova Scotia"],
  ["NT", "Northwest Territories"],
  ["NU", "Nunavut"],
  ["ON", "Ontario"],
  ["PE", "Prince Edward Island"],
  ["QC", "Quebec"],
  ["SK", "Saskatchewan"],
  ["YT", "Yukon"]
];

export default function CommissionerSignUpPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState(initialCommissionerForm);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  function clearMessages() {
    setError("");
  }

  function handleChange(event) {
    const { name, value } = event.target;
    setForm((currentForm) => ({ ...currentForm, [name]: value }));
    clearMessages();
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setIsSubmitting(true);
    clearMessages();

    if (form.password.length < 8) {
      setError("Password must be at least 8 characters.");
      setIsSubmitting(false);
      return;
    }

    if (form.password !== form.confirmPassword) {
      setError("Passwords do not match.");
      setIsSubmitting(false);
      return;
    }

    try {
      const { message } = await authApi.commissionerSignup({
        email: form.email,
        firstName: form.firstName,
        lastName: form.lastName,
        password: form.password,
        province: form.province
      });

      setForm(initialCommissionerForm);
      navigate("/sign-in", { replace: true, state: { notice: message } });
    } catch (signupError) {
      setError(signupError.message);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <AuthPanel
      ariaLabel="Commissioner sign up"
      isBackDisabled={isSubmitting}
      onBack={() => navigate("/sign-in")}
      title="Commissioner Sign Up"
    >
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

        <div className="form-row">
          <div>
            <label htmlFor="firstName">First Name</label>
            <input
              autoComplete="given-name"
              id="firstName"
              name="firstName"
              onChange={handleChange}
              required
              type="text"
              value={form.firstName}
            />
          </div>
          <div>
            <label htmlFor="lastName">Last Name</label>
            <input
              autoComplete="family-name"
              id="lastName"
              name="lastName"
              onChange={handleChange}
              required
              type="text"
              value={form.lastName}
            />
          </div>
        </div>

        <label htmlFor="province">Province</label>
        <select
          autoComplete="address-level1"
          id="province"
          name="province"
          onChange={handleChange}
          required
          value={form.province}
        >
          <option value="">Select province or territory</option>
          {provinces.map(([code, name]) => (
            <option key={code} value={code}>
              {name}
            </option>
          ))}
        </select>

        <label htmlFor="password">Password</label>
        <input
          autoComplete="new-password"
          id="password"
          name="password"
          onChange={handleChange}
          required
          type="password"
          value={form.password}
        />

        <label htmlFor="confirmPassword">Confirm Password</label>
        <input
          autoComplete="new-password"
          id="confirmPassword"
          name="confirmPassword"
          onChange={handleChange}
          required
          type="password"
          value={form.confirmPassword}
        />

        {error ? <p className="form-error">{error}</p> : null}

        <Button className="mt-3 w-full" disabled={isSubmitting} type="submit">
          <UserPlus aria-hidden="true" size={19} />
          <span>
            {isSubmitting ? "Creating account" : "Create commissioner account"}
          </span>
        </Button>
      </form>
    </AuthPanel>
  );
}
