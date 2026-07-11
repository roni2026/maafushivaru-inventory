import { Component } from 'react'

// ─────────────────────────────────────────────────────────────────────────
// ErrorBoundary — catches render-time errors in the component tree so a
// single broken page doesn't white-screen the entire app. Shows a
// user-friendly fallback with a "Reload" button. Errors are also logged
// to the console for debugging.
//
// Note: Error boundaries only catch errors in React render lifecycles,
// not in event handlers or async code. Those are handled by the
// try/catch + toast.error pattern used throughout the app.
// ─────────────────────────────────────────────────────────────────────────
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo)
  }

  handleReload = () => {
    this.setState({ hasError: false, error: null })
    // Force a full page reload to clear any corrupted state
    window.location.reload()
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] p-6 text-center">
          <div className="w-16 h-16 mb-4 rounded-full bg-red-900/30 flex items-center justify-center">
            <svg className="w-8 h-8 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-slate-100 mb-2">Something went wrong</h2>
          <p className="text-sm text-slate-400 mb-4 max-w-md">
            An unexpected error occurred while rendering this page. Try reloading —
            your data is safe.
          </p>
          <button
            onClick={this.handleReload}
            className="px-4 py-2 bg-[#00AEEF] text-white rounded-lg text-sm font-medium hover:bg-[#0097d4] transition-colors"
          >
            Reload Page
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
