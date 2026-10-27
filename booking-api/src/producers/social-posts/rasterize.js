// SVG -> PNG for the Social Posts graphics, using resvg compiled to WebAssembly (runs inside the Worker, no browser).
// The wasm module and the two bundled fonts are loaded on first use only, so every other path stays light.
// Tests inject their own rasterizer; this file is exercised by the live Social Posts self-test.
let ready = null;

async function load() {
  const [{ initWasm, Resvg }, wasm, regular, bold] = await Promise.all([
    import("@resvg/resvg-wasm"),
    import("@resvg/resvg-wasm/index_bg.wasm"),
    import("../../../assets/fonts/LiberationSans-Regular.ttf"),
    import("../../../assets/fonts/LiberationSans-Bold.ttf")
  ]);
  await initWasm(wasm.default);
  return { Resvg, fonts: [new Uint8Array(regular.default), new Uint8Array(bold.default)] };
}

// Returns async (svg, width) => Uint8Array (PNG).
async function createRasterizer() {
  ready = ready || load();
  const { Resvg, fonts } = await ready;
  return async (svg, width) => {
    const resvg = new Resvg(svg, {
      fitTo: { mode: "width", value: width },
      font: { fontBuffers: fonts, defaultFontFamily: "Liberation Sans", loadSystemFonts: false }
    });
    return resvg.render().asPng();
  };
}

export { createRasterizer };
