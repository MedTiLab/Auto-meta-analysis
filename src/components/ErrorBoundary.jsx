import React from 'react';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    // Update state so the next render will show the fallback UI
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    // Log the error details
    console.error('ErrorBoundary caught an error:', error, errorInfo);
    
    // You can also log the error to an error reporting service here
    this.setState({
      error: error,
      errorInfo: errorInfo
    });
  }

  isChunkLoadError() {
    const message = String(this.state.error?.message || this.state.error || '');
    return (
      message.includes('Failed to fetch dynamically imported module') ||
      message.includes('Importing a module script failed') ||
      message.includes('Loading chunk') ||
      message.includes('ChunkLoadError')
    );
  }

  reloadApplication = async () => {
    try {
      if ('serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map(registration => registration.unregister()));
      }

      if ('caches' in window) {
        const cacheNames = await caches.keys();
        await Promise.all(
          cacheNames
            .filter(cacheName => cacheName.startsWith('medhelp-'))
            .map(cacheName => caches.delete(cacheName))
        );
      }
    } catch (error) {
      console.warn('Failed to clear application cache before reload:', error);
    } finally {
      window.location.reload();
    }
  };

  render() {
    if (this.state.hasError) {
      const isChunkLoadError = this.isChunkLoadError();

      // Fallback UI
      return (
        <div className="flex flex-col items-center justify-center p-8 text-center">
          <div className="bg-red-50 border border-red-200 rounded-lg p-6 max-w-md">
            <div className="flex items-center mb-4">
              <div className="flex-shrink-0">
                <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                </svg>
              </div>
              <h3 className="ml-3 text-sm font-medium text-red-800">
                Something went wrong
              </h3>
            </div>
            <div className="text-sm text-red-700">
              <p className="mb-2">
                {isChunkLoadError
                  ? 'The app was updated while this page was open. Refresh to load the latest files.'
                  : 'An error occurred while loading the chat interface.'}
              </p>
              {this.props.showDetails && this.state.error && (
                <details className="mt-4">
                  <summary className="cursor-pointer text-xs font-mono">Error Details</summary>
                  <pre className="mt-2 text-xs bg-red-100 p-2 rounded overflow-auto max-h-40">
                    {this.state.error.toString()}
                    {this.state.errorInfo && this.state.errorInfo.componentStack}
                  </pre>
                </details>
              )}
            </div>
            <div className="mt-4">
              <button
                onClick={isChunkLoadError
                  ? this.reloadApplication
                  : () => {
                      this.setState({ hasError: false, error: null, errorInfo: null });
                      if (this.props.onRetry) this.props.onRetry();
                    }}
                className="bg-red-600 text-white px-4 py-2 rounded text-sm hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500"
              >
                {isChunkLoadError ? 'Refresh App' : 'Try Again'}
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
