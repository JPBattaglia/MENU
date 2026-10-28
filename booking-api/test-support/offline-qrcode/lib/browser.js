// Offline stand-in for the qrcode package, for sandboxes where npm cannot install it (CI uses the real one).
// It must return an SVG with a <path>, or the QR quality check fails and 12 Menu + QR tests fail with it.
// Install: cp -r booking-api/test-support/offline-qrcode booking-api/node_modules/qrcode
export default {
  toString: async () => '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 29 29"><path d="M0 0h7v7H0z"/></svg>'
};
