var through = require('through')
var get = require('./immutable-helpers').get
var toJS = require('./immutable-helpers').toJS
var mutate = require('./immutable-helpers').mutate
var isImmutable = require('./immutable-helpers').isImmutable
var coerceKeyPath = require('./utils').keyPath
var coerceArray = require('./utils').coerceArray
var each = require('./utils').each
var Immutable = require('immutable')
var logging = require('./logging')

var ReactorCore = require('./ReactorCore')

/**
 * In Nuclear Reactors are where state is stored.  Reactors
 * contain a "state" object which is an Immutable.Map
 *
 * The only way Reactors can change state is by reacting to
 * messages.  To update staet, Reactor's dispatch messages to
 * all registered cores, and the core returns it's new
 * state based on the message
 */
class Reactor {
  constructor() {
    /**
     * The state for the whole cluster
     */
    this.state = Immutable.Map({})
    /**
     * Holds a map of id => reactor instance
     */
    this.reactorCores = {}

    /**
     * messages are written to this input stream and flushed
     * whenever the `react` method is called
     */
    this.inputStream = through(msg => {
      this.cycle(msg)
    })

    /**
     * Output stream that emits the state of the reactor cluster anytime
     * a cycle happens
     */
    this.outputStream = through()
  }

  /**
   * Gets the coerced state (to JS object) of the reactor by keyPath
   * @param {array|string} keyPath
   * @return {*}
   */
  get(keyPath) {
    return toJS(this.getImmutable(keyPath))
  }

  /**
   * Gets the Immutable state at the keyPath
   * @param {array|string} keyPath
   * @return {*}
   */
  getImmutable(keyPath) {
    return get(this.state, coerceKeyPath(keyPath))
  }

  /**
   * Executes all the messages in the message queue and emits the new
   * state of the cluster on the output stream
   * @param {array} messages
   */
  cycle(messages) {
    messages = coerceArray(messages)
    var state = this.state
    var cores = this.reactorCores

    this.state = mutate(state, state => {
      while (messages.length > 0) {
        var message = messages.shift()

        logging.cycleStart(message)

        each(cores, (core, id) => {
          // dont let the reactor mutate by reference
          var reactorState = state.get(id).asImmutable()
          var newState = core.react(
            reactorState,
            message.type,
            message.payload
          )
          state.set(id, newState)

          logging.coreReact(id, reactorState, newState)
        })

        logging.cycleEnd(state)
      }
    })

    // write the new state to the output stream
    this.outputStream.write(this.state)
  }

  /**
   * Cores represent distinct "silos" in your Reactor state
   * When a core is attached the `initialize` method is called
   * and the core's initial state is returned.
   *
   * Anytime a Reactor.react happens all of the cores are passed
   * the message have the opportunity to return a "new state" to
   * the Reactor
   *
   * @param {string} id
   * @param {ReactorCore} Core
   */
  attachCore(id, core) {
    if (this.reactorCores[id]) {
      throw new Error("Only one reactor can be registered per id")
    }
    if (!(core instanceof ReactorCore)) {
      core = new Core()
    }
    var initialState = core.initialize() || {}
    this.state = this.state.set(id, Immutable.fromJS(initialState))
    this.reactorCores[id] = core
  }

  unattachCore(id) {
    delete this.reactorCores[id]
  }
}

module.exports = Reactor
