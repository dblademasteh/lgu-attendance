import React from 'react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error) {
    console.error('UI error:', error);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="card p-8 m-6 text-center">
          <h2 className="font-semibold text-ink">Something went wrong</h2>
          <p className="text-sm text-muted mt-2">{String(this.state.error?.message ?? this.state.error)}</p>
          <button type="button" className="btn btn-outline mt-4" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
