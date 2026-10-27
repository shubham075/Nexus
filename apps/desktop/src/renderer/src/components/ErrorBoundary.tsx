import { Component, type ReactNode } from 'react';

/** Keeps one broken screen from blanking the whole window; resets when the route changes. */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidUpdate(prev: { resetKey?: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="mx-auto mt-16 max-w-md text-center">
        <div className="card p-8">
          <div className="text-lg font-semibold">Something went wrong on this screen</div>
          <p className="mt-1 text-sm text-zinc-500">{this.state.error.message}</p>
          <button className="btn-primary mt-4" onClick={() => this.setState({ error: null })}>Try again</button>
        </div>
      </div>
    );
  }
}
