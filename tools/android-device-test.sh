#!/usr/bin/env bash
# Android device test (store-app-build.yml, job android-device-test). Runs inside the virtual Android phone step:
# installs the signed Sample Cafe app, opens it, waits for it to register for notifications with the worker, asks the
# worker to send it one notification (POST /api/store-build/android-push-test), then checks the notification reached
# the phone. Public logs: prints only yes/no and counts, never tokens or content.
set -uo pipefail
PKG="${PACKAGE:?}"
mkdir -p "$SHOTS"
shot() { adb exec-out screencap -p > "$SHOTS/$1.png" 2>/dev/null || true; }
say() { echo "$1" | tee -a "$GITHUB_STEP_SUMMARY"; }

adb wait-for-device
adb install -r "$APK" >/dev/null || { say "FAIL: the app didn't install"; exit 1; }
say "Installed: yes"
adb shell pm grant "$PKG" android.permission.POST_NOTIFICATIONS || true
adb shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
sleep 20
adb shell pidof "$PKG" >/dev/null || { shot app-crashed; say "FAIL: the app isn't running after opening it"; adb logcat -d -s AndroidRuntime:E | tail -20; exit 1; }
shot 1-app-open
say "App opens and keeps running: yes"

# Leave the app (notifications for an app on screen go to the app, not the notification shade).
sleep 25
adb shell input keyevent KEYCODE_HOME
sleep 3

# What the phone saw, with anything token-like blanked (public log).
diag() {
  echo "--- diagnostics"
  echo "notifications from the app: $(adb shell dumpsys notification --noredact | grep -c "pkg=$PKG")"
  echo "app process running: $(adb shell pidof "$PKG" >/dev/null && echo yes || echo no)"
  echo "Google Play services: $(adb shell dumpsys package com.google.android.gms | grep -m1 versionName | tr -d ' ')"
  adb shell dumpsys notification --noredact | grep -E "pkg=$PKG|android.title|android.text" | head -10
  adb logcat -d | grep -E "FirebaseMessaging|FirebaseInstallations|FirebaseApp|Capacitor|PushNotifications|GmsGcmRegistr|GCM[A-Za-z]*:|$PKG" | grep -v NetworkScheduler | sed -E 's/[A-Za-z0-9_:-]{60,}/<hidden>/g' | tail -40
}
oidc() { curl -sSf -H "Authorization: Bearer $ACTIONS_ID_TOKEN_REQUEST_TOKEN" "$ACTIONS_ID_TOKEN_REQUEST_URL&audience=menu-made-store-build" | jq -r .value; }
TEXT="Android device test $RUN_ID"
sent=no
for i in $(seq 1 32); do
  token=$(oidc); echo "::add-mask::$token"
  code=$(jq -n --arg b "$TEXT" '{title: "Sample Cafe", body: $b}' | curl -sS -o "$RUNNER_TEMP/push.json" -w '%{http_code}' -X POST \
    -H "Authorization: Bearer $token" -H "Content-Type: application/json" --data-binary @- \
    "https://menu-made.com/api/store-build/android-push-test?scope=owner")
  if [ "$code" = "200" ]; then sent=yes; break; fi
  echo "worker answered $code: $(jq -r '.error // "?"' "$RUNNER_TEMP/push.json") ($i/32)"
  [ "$code" = "404" ] || break
  sleep 15
done
if [ "$sent" != yes ]; then
  shot no-registration
  say "FAIL: the phone never registered for notifications with the worker, or Firebase refused the send"
  diag
  exit 1
fi
say "Registered with the worker and sent through Firebase: yes"

for i in $(seq 1 60); do
  if adb shell dumpsys notification --noredact | grep -q "$TEXT"; then
    adb shell cmd statusbar expand-notifications; sleep 2; shot 2-notification
    say "Notification reached the phone: yes"
    exit 0
  fi
  sleep 5
done
adb shell cmd statusbar expand-notifications; sleep 2; shot 2-no-notification
say "FAIL: the notification didn't reach the phone within 5 minutes"
diag
exit 1
