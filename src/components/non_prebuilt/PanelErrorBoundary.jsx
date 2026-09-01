import { Component } from "react";

export class PanelErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("Map InfoPanel rendering failed:", error, info);
  }

  componentDidUpdate(previousProps) {
    if (previousProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <section className="map-info-panel__local-error" role="alert">
        <strong>This panel could not be displayed.</strong>
        <p>The map remains available. Retry the panel or choose another area.</p>
        <button type="button" onClick={() => this.setState({ error: null })}>
          Retry panel
        </button>
      </section>
    );
  }
}
