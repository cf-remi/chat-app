import { useState, useEffect } from "react";
import { useAuth } from "../context/AuthContext.jsx";
import { oauthLink } from "../api.js";

const API_BASE = import.meta.env.VITE_API_BASE || "";

export default function LoginScreen() {
  const { login, register, setUser } = useAuth();
  const [isRegister, setIsRegister] = useState(false);
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // OAuth link-account modal state
  const [linkToken, setLinkToken] = useState(null);
  const [linkPassword, setLinkPassword] = useState("");
  const [linkError, setLinkError] = useState("");
  const [linkLoading, setLinkLoading] = useState(false);
  const [oauthError, setOauthError] = useState("");

  // On mount, check URL params for link_token or oauth_error
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const lt = params.get("link_token");
    const oe = params.get("oauth_error");
    if (lt) {
      setLinkToken(lt);
      // Clean URL
      window.history.replaceState({}, "", window.location.pathname);
    }
    if (oe) {
      setOauthError(decodeURIComponent(oe));
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      if (isRegister) {
        await register(username.trim(), email.trim(), password);
      } else {
        await login(email.trim(), password);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleLinkAccount = async (e) => {
    e.preventDefault();
    setLinkError("");
    setLinkLoading(true);
    try {
      const data = await oauthLink(linkToken, linkPassword);
      setUser(data.user);
    } catch (err) {
      setLinkError(err.message);
    } finally {
      setLinkLoading(false);
    }
  };

  const canSubmit = isRegister
    ? username.trim() && email.trim() && password.length >= 8
    : email.trim() && password;

  return (
    <div className="login-screen">
      {/* Link-account modal */}
      {linkToken && (
        <div className="oauth-link-overlay" role="dialog" aria-modal="true" aria-label="Link account">
          <form className="oauth-link-card" onSubmit={handleLinkAccount}>
            <h2>Link Account</h2>
            <p>
              An account with this email already exists. Enter your password to link your social
              login to it, or{" "}
              <button
                type="button"
                className="link-btn"
                onClick={() => setLinkToken(null)}
              >
                cancel
              </button>
              .
            </p>
            {linkError && <div className="login-error">{linkError}</div>}
            <input
              type="password"
              placeholder="Your password"
              value={linkPassword}
              onChange={(e) => setLinkPassword(e.target.value)}
              autoFocus
            />
            <button type="submit" disabled={!linkPassword || linkLoading}>
              {linkLoading ? "Linking..." : "Link & Sign In"}
            </button>
          </form>
        </div>
      )}

      <form className="login-card" onSubmit={handleSubmit}>
        <h1>Welcome to Chat App</h1>
        <p>{isRegister ? "Create an account" : "Log in to continue"}</p>

        {(error || oauthError) && (
          <div className="login-error">{error || oauthError}</div>
        )}

        {isRegister && (
          <input
            type="text"
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
            maxLength={32}
          />
        )}

        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoFocus={!isRegister}
        />

        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        <button type="submit" disabled={!canSubmit || loading}>
          {loading ? "..." : isRegister ? "Register" : "Log In"}
        </button>

        {/* SSO divider */}
        <div className="sso-divider">
          <span>or continue with</span>
        </div>

        {/* Google SSO */}
        <a
          href={`${API_BASE}/auth/google`}
          className="sso-btn sso-btn--google"
        >
          <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
            <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
            <path fill="none" d="M0 0h48v48H0z"/>
          </svg>
          Google
        </a>

        {/* Apple SSO */}
        <a
          href={`${API_BASE}/auth/apple`}
          className="sso-btn sso-btn--apple"
        >
          <svg width="18" height="18" viewBox="0 0 814 1000" aria-hidden="true" fill="currentColor">
            <path d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76.5 0-103.7 40.8-165.9 40.8s-105-28.4-154.9-91.3C66.1 781 24 694.3 24 612.7c0-143.1 93.6-220 181.3-220 29.1 0 116.6 31.2 195.6 31.2 76.5 0 156.8-32.6 185.9-32.6 45.8 0 135.3 56.5 201.3 155.6zm-147-148.2c0 93.8-66.1 162.8-130.6 162.8-11.5 0-23.5-1.3-35-3.8-7.7-16-23.5-48.4-23.5-80.7 0-88.9 55.1-161.8 125.6-161.8 9 0 27.5 1.9 40.2 4.5 1.3 25.8 23.3 78.1 23.3 79z"/>
          </svg>
          Apple
        </a>

        <p className="login-toggle">
          {isRegister ? "Already have an account?" : "Need an account?"}{" "}
          <button
            type="button"
            className="link-btn"
            onClick={() => {
              setIsRegister(!isRegister);
              setError("");
            }}
          >
            {isRegister ? "Log In" : "Register"}
          </button>
        </p>
      </form>
    </div>
  );
}
