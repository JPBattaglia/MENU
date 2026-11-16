# Rules for every change in this repo

## Site changes must reach the apps (owner, Nov 14, 2026)
The owner's two store apps (MΞNU and Nino Battaglia) are drawn by `app-shell/www/` (hybrid.js, app.js, app.css).
"Every site change on menu or Nino website must automatically update the apps."

- In the same task as any change a visitor can see on menu-made.com or ninobattaglia.com (layout, wording, prices,
  options, buttons, flows), check whether the matching app screen shows that thing, and if it does, make the same
  change in `app-shell/www/` in the same PR (or, for a NinoSite change, a MENU PR opened right after it).
  Say in the PR which app screen was updated, or why none needed it.
- Data the apps read live (products, prices, plans, photos, colours) already updates by itself through
  `GET /api/app-hybrid/<key>` (booking-api/src/store-app/hybrid.js); keep that endpoint in step with site data changes.
- Screen code reaches installed apps with no store build: `app-shell/www/live.js` runs the newest hybrid.js / app.js /
  app.css served at https://menu-made.com/app-shell/www/ (deployed on every merge to master). Only native changes
  (icon, splash, plugins, permissions) need an App Store / Google Play build.
- If live code starts relying on something only a newer app build has, put `// live-shell-min: N` (N = that build's
  `SHELL` in live.js) in the first lines of the file, and raise `SHELL` in live.js in that build. Older apps then keep
  the bundled code instead of breaking.
- Never break the live files: a syntax error in app-shell/www ships to every phone at the next launch (live.js falls
  back to the bundled copy only after a failed start). Run `node --check` and booking-api/app-live-code.test.mjs.
- **Zoom is paramount (owner, Nov 14, 2026):** the Nino product photo must always open the full-screen viewer with
  pinch and double-tap zoom (zoomViewer in hybrid.js), on Android and iPhone. Never remove or break it; the test in
  booking-api/app-live-code.test.mjs guards it.

## How-to videos follow the generators (owner, Nov 15, 2026)
The videos beside the free generators (online-menu.html, website-design.html, holiday-menu.html) and in the MΞNU app's
Preview tab are made by `tools/howto-videos/record.mjs`. Any change a visitor can see in a generator (its form, the
preview bar's buttons, the Customize window, the menu editor's languages) means re-running it in the same task:

    node --no-warnings --import ./tools/howto-videos/stand-ins/register.mjs tools/howto-videos/record.mjs [menu|website|holiday]

It records the repo's own pages and worker against a throwaway local database (nothing is counted, emailed or charged)
and writes assets/video/*.mp4 and *-poster.jpg. Then bump the `?v=` on the three pages and HOWTO_VIDEO_VERSION in
booking-api/src/store-app/hybrid.js together (booking-api/hybrid-app.test.mjs checks they match), and watch the result.
