// Offline stand-in for the qrcode package, for sandboxes where npm cannot install it (CI uses the real one).
// It must return an SVG with a <path>, or the QR quality check fails and 12 Menu + QR tests fail with it.
// create() returns a fixed 21x21 pattern with the three finder squares, enough for the print-PDF tests.
// Install: cp -r booking-api/test-support/offline-qrcode booking-api/node_modules/qrcode
const finder = (r, c) => [[0, 0], [0, 14], [14, 0]].some(([fr, fc]) => {
  const y = r - fr, x = c - fc;
  if (y < 0 || x < 0 || y > 6 || x > 6) return false;
  return y === 0 || y === 6 || x === 0 || x === 6 || (y >= 2 && y <= 4 && x >= 2 && x <= 4);
});
export default {
  toString: async () => '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 29 29"><path d="M0 0h7v7H0z"/></svg>',
  create: () => ({ modules: { size: 21, get: (r, c) => finder(r, c) || (r * 7 + c * 3) % 5 === 0 } })
};
