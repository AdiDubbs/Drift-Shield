import React from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { Button } from './ui/button'
import { Card } from './ui/card'

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, info) {
    console.error('ErrorBoundary caught:', error, info)
  }

  render() {
    if (this.state.hasError) {
      return (
        <Card className="card-glass flex flex-col items-center justify-center gap-3 rounded-lg p-8 text-center">
          <AlertTriangle className="h-5 w-5 text-accent-amber" />
          <div>
            <p className="typo-body font-medium text-text-primary">Panel unavailable</p>
            <p className="mt-0.5 typo-body-sm text-text-muted">
              {this.state.error?.message || 'An unexpected error occurred'}
            </p>
          </div>
          <Button
            onClick={() => this.setState({ hasError: false, error: null })}
            variant="secondary"
            size="sm"
          >
            <RefreshCw className="h-3 w-3" />
            Retry
          </Button>
        </Card>
      )
    }
    return this.props.children
  }
}

export default ErrorBoundary
