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
