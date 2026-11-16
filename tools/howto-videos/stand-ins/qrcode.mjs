// Stand-in for the qrcode package, only where it can't be installed. The generator previews never draw a QR code.
const box = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#000"/></svg>';
const QRCode = { toString: async () => box, toDataURL: async () => 'data:image/svg+xml,' + encodeURIComponent(box), create: () => ({ modules: { size: 1, get: () => 1, data: [1] } }) };
export default QRCode;
