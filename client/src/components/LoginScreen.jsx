import { useState } from "react";
import { useAuth } from "../context/AuthContext.jsx";

export default function LoginScreen() {
  const { login, register } = useAuth();
  const [isRegister, setIsRegister] = useState(false);
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

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

  const canSubmit = isRegister
    ? username.trim() && email.trim() && password.length >= 6
    : email.trim() && password;

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={handleSubmit}>
        <h1>Welcome to Discord RTK</h1>
        <p>{isRegister ? "Create an account" : "Log in to continue"}</p>

        {error && <div className="login-error">{error}</div>}

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
