import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../static/app/app.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../static/app/app.css", import.meta.url), "utf8");
const html = readFileSync(new URL("../static/app/index.html", import.meta.url), "utf8");
const worker = readFileSync(new URL("../static/app/sw.js", import.meta.url), "utf8");

assert.match(app, /tileWatchdog/);
assert.match(app, /activateFallback/);
assert.match(app, /tile\.openstreetmap\.org/);
assert.match(app, /leaflet-runtime/);
assert.match(app, /theme:\s*"outline"/);
assert.match(app, /text:\s*"continue_with"/);
assert.match(app, /logo_alignment:\s*"left"/);
assert.match(css, /map-fallback-active/);
assert.match(html, /20260729-map-social-2/);
assert.match(worker, /parkswap-web-v25-map-social/);
assert.match(html, /Your position/);
assert.match(html, /Parking nearby/);
assert.match(html, /Available parking now/);

console.log("ParkSwap resilient map and social sign-in contract passed.");
