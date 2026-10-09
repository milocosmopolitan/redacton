# Helper

`npm run build:helper` compiles the strict TypeScript source to ignored `helper/dist/` and generates the Mod canonical type allowlist from the sole JSON registry. Release artifacts include compiled JavaScript; Node 22 or 24 runs `helper/dist/index.js` without TypeScript tooling.

The helper accepts one bounded JSON request on stdin and emits one JSON response. It never writes input or exception text to diagnostics. The Mod enforces its own process deadline because synchronous Rust scans can block Node timers. Native and WASM bindings use the pinned Rust detector core.
