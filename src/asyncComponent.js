import React from 'react'
import PropTypes from 'prop-types'

const validSSRModes = ['resolve', 'defer', 'boundary']

function asyncComponent(config) {
  const {
    name,
    resolve,
    autoResolveES2015Default = true,
    serverMode = 'resolve',
    LoadingComponent,
    ErrorComponent,
	getModuleId = () => 'staticKey',
  } = config

  if (validSSRModes.indexOf(serverMode) === -1) {
    throw new Error('Invalid serverMode provided to asyncComponent')
  }

  const env = ['node', 'browser'].indexOf(config.env) > -1
    ? config.env
    : typeof window === 'undefined' ? 'node' : 'browser'

  const sharedState = {
    // A unique id we will assign to our async component which is especially
    // useful when rehydrating server side rendered async components.
    id: null,
    // This will be use to hold the resolved module allowing sharing across
    // instances.
    // NOTE: When using React Hot Loader this reference will become null.
    modules: {},
    // If an error occurred during a resolution it will be stored here.
    error: null,
    // Allows us to share the resolver promise across instances.
    resolver: null,
  }

  // Takes the given module and if it has a ".default" the ".default" will
  // be returned. i.e. handy when you could be dealing with es6 imports.
  const es6Resolve = x =>
    autoResolveES2015Default &&
      x != null &&
      (typeof x === 'function' || typeof x === 'object') &&
      x.default
      ? x.default
      : x

  const getResolver = (props) => {
    if (sharedState.resolver == null) {
      try {
        // Wrap whatever the user returns in Promise.resolve to ensure a Promise
        // is always returned.
        const resolver = resolve(props)
        sharedState.resolver = Promise.resolve(resolver)
      } catch (err) {
        sharedState.resolver = Promise.reject(err)
      }
    }
    return sharedState.resolver
  }

  class AsyncComponent extends React.Component {
    static displayName = name || 'AsyncComponent';

    static contextTypes = {
      asyncComponentsAncestor: PropTypes.shape({
        isBoundary: PropTypes.bool,
      }),
      asyncComponents: PropTypes.shape({
        getNextId: PropTypes.func.isRequired,
        resolved: PropTypes.func.isRequired,
        shouldRehydrate: PropTypes.func.isRequired,
      }),
    };

    static childContextTypes = {
      asyncComponentsAncestor: PropTypes.shape({
        isBoundary: PropTypes.bool,
      }),
    };

    constructor(props, context) {
      super(props, context)

      // We have to set the id in the constructor because a RHL seems
      // to recycle the module and therefore the id closure will be null.
      // We can't put it in componentWillMount as RHL hot swaps the new code
      // so the mount call will not happen (but the ctor does).
      if (this.context.asyncComponents && !sharedState.id) {
        sharedState.id = this.context.asyncComponents.getNextId()
      }
    }

    // @see react-async-bootstrapper
    asyncBootstrap() {
      const { asyncComponents, asyncComponentsAncestor } = this.context
      const { shouldRehydrate } = asyncComponents

      const doResolve = () =>
        this.resolveModule().then(module => module !== undefined)

      if (env === 'browser') {
        return shouldRehydrate(sharedState.id) ? doResolve() : false
      }

      // node
      const isChildOfBoundary = asyncComponentsAncestor &&
        asyncComponentsAncestor.isBoundary
      return serverMode === 'defer' || isChildOfBoundary ? false : doResolve()
    }

    getChildContext() {
      if (!this.context.asyncComponents) {
        return undefined
      }

      return {
        asyncComponentsAncestor: {
          isBoundary: serverMode === 'boundary',
        },
      }
    }

    componentWillMount() {
      this.setState({ modules: sharedState.modules })
      if (sharedState.error) {
        this.registerErrorState(sharedState.error)
      }
    }

    componentDidMount() {
      if (!this.state.modules[getModuleId(this.props)]) {
        this.resolveModule()
      }
    }

    resolveModule() {
      this.resolving = true

	  let moduleId = getModuleId(this.props);
      return getResolver(this.props)
        .then((module) => {
          if (this.unmounted) {
            return undefined
          }
          if (this.context.asyncComponents) {
            this.context.asyncComponents.resolved(sharedState.id)
          }
          sharedState.modules[moduleId] = module
          if (env === 'browser') {
            this.setState({ modules:sharedState.modules })
          }
          this.resolving = false
          return module
        })
        .catch((error) => {
          if (this.unmounted) {
            return undefined
          }
          if (env === 'node' || (env === 'browser' && !ErrorComponent)) {
            // We will at least log the error so that user isn't completely
            // unaware of an error occurring.
            // eslint-disable-next-line no-console
            console.warn('Failed to resolve asyncComponent')
            // eslint-disable-next-line no-console
            console.warn(error)
          }
          sharedState.error = error
          this.registerErrorState(error)
          this.resolving = false
          return undefined
        })
    }

    componentWillReceiveProps(nextProps) {
		console.log("module id compare", getModuleId(this.props), getModuleId(nextProps));
		if (getModuleId(this.props) !== getModuleId(nextProps)) {
			// FIXME add LoadingComponent logic to show old module for X ms (to prevent flash of content) and then show a loading component till the new module is loaded
			// FIXME handle case when module id changes while resolving a module
			this.resolveModule();
		}
    }

    componentWillUnmount() {
      this.unmounted = true
    }

    registerErrorState(error) {
      if (env === 'browser') {
        setTimeout(
          () => {
            if (!this.unmounted) {
              this.setState({ error })
            }
          },
          16,
        )
      }
    }

    render() {
      const { modules, error } = this.state

      // This is as workaround for React Hot Loader support.  When using
      // RHL the local component reference will be killed by any change
      // to the component, this will be our signal to know that we need to
      // re-resolve it.
      if (
        sharedState.module[getModuleId(this.props)] == null &&
        !this.resolving &&
        typeof window !== 'undefined'
      ) {
        this.resolveModule()
      }

      if (error) {
        return ErrorComponent
          ? <ErrorComponent {...this.props} error={error} />
          : null
      }

      const Component = es6Resolve(modules[getModuleId(this.props)])
      // eslint-disable-next-line no-nested-ternary
      return Component
        ? config.render ? config.render(Component) : <Component {...this.props} />
        : LoadingComponent ? <LoadingComponent {...this.props} /> : null
    }
  }

  return AsyncComponent
}

export default asyncComponent
