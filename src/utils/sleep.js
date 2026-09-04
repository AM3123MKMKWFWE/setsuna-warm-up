export class OperationAbortedError extends Error {
  constructor(message = "Operasi dibatalkan") {
    super(message)
    this.name = "OperationAbortedError"
  }
}

export function sleep(ms, options = {}) {
  if (!Number.isFinite(ms) || ms < 0) {
    return Promise.reject(new TypeError("Durasi sleep harus berupa angka non-negatif"))
  }

  const signal = options.signal

  if (signal?.aborted) {
    return Promise.reject(new OperationAbortedError())
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort)
      resolve()
    }, ms)

    function onAbort() {
      clearTimeout(timeout)
      signal.removeEventListener("abort", onAbort)
      reject(new OperationAbortedError())
    }

    signal?.addEventListener("abort", onAbort, { once: true })
  })
}
