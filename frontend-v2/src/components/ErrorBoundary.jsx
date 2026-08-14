import { Component } from 'react';

// React only supports catching render errors via a class component's
// getDerivedStateFromError/componentDidCatch — there's no hook equivalent.
// Without this, ANY unhandled error while rendering a page (a null
// reference on an unexpected API shape, a bad prop) takes down the entire
// app to a blank white screen for every user, with no way back short of a
// hard refresh — exactly what was found missing in the platform audit.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error('Caught by ErrorBoundary:', error, info?.componentStack);
  }

  render() {
    if (this.state.error) {
      return this.props.fallback(this.state.error, () => this.setState({ error: null }));
    }
    return this.props.children;
  }
}
