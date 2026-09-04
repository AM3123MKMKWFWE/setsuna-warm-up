import qrcode from "qrcode-terminal"

let renderQueue = Promise.resolve()

export function renderTerminalQr(sessionName, qr, options = {}) {
  renderQueue = renderQueue.then(
    () =>
      new Promise((resolve) => {
        process.stdout.write(`\nScan QR untuk ${sessionName}:\n`)
        if (options.showRaw) {
          process.stdout.write(
            `QR_DATA_${sessionName.toUpperCase().replaceAll("-", "_")}_START\n${qr}\nQR_DATA_${sessionName.toUpperCase().replaceAll("-", "_")}_END\n`
          )
        }
        qrcode.generate(qr, { small: true }, (output) => {
          process.stdout.write(`${output}\n`)
          resolve()
        })
      })
  )

  return renderQueue
}
