export const SESSION_STATE = Object.freeze({
  STOPPED: "stopped",
  INITIALIZING: "initializing",
  CONNECTING: "connecting",
  READY: "ready",
  DISCONNECTED: "disconnected",
  RECONNECTING: "reconnecting",
  LOGGED_OUT: "logged-out"
})

export class SessionNotReadyError extends Error {
  constructor(sessionName, state) {
    super(`Session ${sessionName} belum siap; state saat ini: ${state}`)
    this.name = "SessionNotReadyError"
    this.sessionName = sessionName
    this.state = state
  }
}

export class MessageDeliveryTimeoutError extends Error {
  constructor(sessionName, messageId, timeoutMs) {
    super(
      `Status delivery pesan ${messageId} pada ${sessionName} tidak diterima dalam ${timeoutMs}ms`
    )
    this.name = "MessageDeliveryTimeoutError"
    this.sessionName = sessionName
    this.messageId = messageId
    this.timeoutMs = timeoutMs
  }
}
