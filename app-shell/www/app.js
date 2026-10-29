// Store App screens. Pipeline-proof version: reads the build config and shows the restaurant name.
// The full screens (menu, specials, hours, call, ordering link, rewards card, push opt-in) replace this next.
(async () => {
  try {
    const cfg = await (await fetch("config.json")).json();
    document.documentElement.style.setProperty("--brand", cfg.brand_color);
    document.title = cfg.app_name;
    document.getElementById("name").textContent = cfg.app_name;
  } catch {
    document.getElementById("name").textContent = "App";
  }
})();
