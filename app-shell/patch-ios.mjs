// Adds what native push needs to the iOS project that `npx cap add ios` generates on every build:
// the two AppDelegate callbacks Capacitor's push plugin listens for (Capacitor docs, Push Notifications, iOS setup).
// Safe to run twice. Usage (from app-shell/): node patch-ios.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";


const CALLBACKS = `
    // Native push (added by app-shell/patch-ios.mjs): hand Apple's device token to Capacitor's push plugin.
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications, object: deviceToken)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)
    }
`;

function patch(text) {
  if (text.includes("capacitorDidRegisterForRemoteNotifications")) return text;
  const classAt = text.search(/class\s+AppDelegate\b/);
  if (classAt < 0) throw new Error("AppDelegate class not found");
  const end = text.lastIndexOf("}");
  if (end < classAt) throw new Error("AppDelegate closing brace not found");
  return `${text.slice(0, end).replace(/\s*$/, "\n")}${CALLBACKS}}\n`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = process.argv[2] || join(dirname(fileURLToPath(import.meta.url)), "ios", "App", "App", "AppDelegate.swift");
  const source = readFileSync(file, "utf8");
  const out = patch(source);
  if (out !== source) writeFileSync(file, out);
  console.log(out === source ? "AppDelegate already has the push callbacks" : "AppDelegate: push callbacks added");
}

export { patch };
