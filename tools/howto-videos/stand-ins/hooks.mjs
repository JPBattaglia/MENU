// Node resolve hook for the recorder: a package missing from booking-api/node_modules is taken from the global
// install (pdf-lib) or a stand-in (qrcode). With `npm ci` in booking-api nothing here is used.
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
const globalRoot = execSync('npm root -g').toString().trim();
export async function resolve(specifier, context, next) {
  try { return await next(specifier, context); } catch (error) {
    if (specifier.startsWith('qrcode')) return { url: new URL('./qrcode.mjs', import.meta.url).href, shortCircuit: true };
    if (specifier === 'pdf-lib') return next(pathToFileURL(`${globalRoot}/pdf-lib/cjs/index.js`).href, context);
    throw error;
  }
}
