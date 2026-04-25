import { Component, type ErrorInfo, type ReactNode } from "react";
import { reportClientEvent } from "@/lib/telemetry";

type Props = { children: ReactNode };
type State = { error: Error | null };

/**
 * Surfaces React render errors instead of a blank screen (Vite overlay can be off).
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[RexAlgo]", error, info.componentStack);
    reportClientEvent({
      type: "react_error",
      message: error.message,
      data: { componentStack: info.componentStack.slice(0, 2000) },
    });
  }

  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            minHeight: "100vh",
            padding: "2rem",
            fontFamily: "system-ui, sans-serif",
            background: "#111",
            color: "#eee",
          }}
        >
          <h1 style={{ fontSize: "1.25rem", marginBottom: "0.5rem" }}>Something broke</h1>
          <pre
            style={{
              whiteSpace: "pre-wrap",
              fontSize: "0.85rem",
              opacity: 0.9,
              marginBottom: "1rem",
            }}
          >
            {this.state.error.message}
          </pre>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              padding: "0.5rem 1rem",
              cursor: "pointer",
              borderRadius: "8px",
              border: "1px solid #444",
              background: "#222",
              color: "#fff",
            }}
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
