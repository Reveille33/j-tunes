import { Component, type ErrorInfo, type ReactNode } from 'react'

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  error: Error | null
}

/**
 * Catches render errors so a single malformed row cannot blank the whole
 * window. Offers a reload, which re-reads the database.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Unhandled UI error', error, info.componentStack)
  }

  override render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="error-screen">
        <h1>Something went wrong</h1>
        <p className="error-screen-message">{error.message}</p>
        <div className="error-screen-actions">
          <button className="button button-primary" onClick={() => window.location.reload()}>
            Reload
          </button>
          <button className="button" onClick={() => this.setState({ error: null })}>
            Try again
          </button>
        </div>
      </div>
    )
  }
}