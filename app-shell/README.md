# Store App shell (stage 11 part 2)

One native app for every restaurant (Capacitor: the web screens run inside a real iOS / Android app with
native push). Each restaurant's build differs only by its build config: app id, name, colours, icons and the
worker address its content loads from. Menu, specials and rewards load live from the worker, so a menu change
never needs a store update.

Built by `.github/workflows/store-app-build.yml` on GitHub's standard runners (free and unmetered because this
repo is public: macOS for iOS, Linux for Android). This repo is public, so build logs are public: nothing here
may print customer data, keys or signing material.

- `configure.mjs <build.json>` writes `capacitor.config.json` and `www/config.json` from a build config.
- `sample/build.json` is the fictional Sample Cafe used to prove the pipeline (unsigned builds, no store upload).
- `www/` holds the app's screens.
