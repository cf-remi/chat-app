import { Component } from "react";

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error("ErrorBoundary caught an error:", error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          height: "100vh",
          gap: "1rem",
          fontFamily: "sans-serif",
          color: "#ccc",
          background: "#1e1e2e",
        }}>
          <h2 style={{ color: "#f38ba8" }}>Something went wrong</h2>
          <p style={{ maxWidth: 400, textAlign: "center", color: "#a6adc8" }}>
            {this.state.error?.message || "An unexpected error occurred."}
          </p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            style={{
              padding: "0.5rem 1.5rem",
              background: "#89b4fa",
              color: "#1e1e2e",
              border: "none",
              borderRadius: 6,
              cursor: "pointer",
              fontWeight: 600,
            }}
          >
            Try again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
