import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("builds the complete ParkSwap landing page", async () => {
  const html = await readFile(new URL("dist/client/index.html", root), "utf8");

  assert.match(html, /<title>ParkSwap — Street parking, shared in real time<\/title>/i);
  assert.match(html, /Street parking,[\s\S]*shared in real time\./i);
  assert.match(html, /How it works/i);
  assert.match(html, /Safety & trust/i);
  assert.match(html, /apps\.apple\.com\/us\/app\/parkswap(?:-swap-your-spot)?\/id1494510599/i);
  assert.match(html, /class="app-store-badge"/i);
  assert.match(html, /href="\/app\/"/i);
  assert.match(html, /Leaving Soon\?/i);
  assert.match(html, /Works on any phone/i);
  assert.doesNotMatch(html, /Google Play|CarPlay|parking management services/i);
});

test("packages the production worker and brand assets", async () => {
  await Promise.all([
    access(new URL("dist/server/index.js", root)),
    access(new URL("dist/.openai/hosting.json", root)),
    access(new URL("dist/client/styles.css", root)),
    access(new URL("dist/client/assets/parkswap-app-icon.png", root)),
    access(new URL("dist/client/assets/parkswap-logo.png", root)),
    access(new URL("dist/client/assets/parking-map.png", root)),
    access(new URL("dist/client/parkswap-app-icon.png", root)),
    access(new URL("dist/client/looking-parking.png", root)),
    access(new URL("dist/client/leaving-parking.png", root)),
    access(new URL("dist/client/parking-map.png", root)),
    access(new URL("dist/client/tracking.png", root)),
  ]);
});

test("preserves ParkSwap's indexed public routes", async () => {
  const routes = [
    ["aboutUs/index.html", /https:\/\/parkswap\.com\/aboutUs/i],
    ["privacy/index.html", /https:\/\/parkswap\.com\/privacy/i],
    ["terms/index.html", /https:\/\/parkswap\.com\/terms/i],
    ["blog-detail/index.html", /https:\/\/parkswap\.com\/blog-detail\?blog=1/i],
  ];

  for (const [file, canonical] of routes) {
    const html = await readFile(new URL(`dist/client/${file}`, root), "utf8");
    assert.match(html, canonical);
    assert.match(html, /parkswap-app-icon\.png/i);
    assert.doesNotMatch(html, /CarPlay|Android Auto/i);
  }

  await Promise.all([
    access(new URL("dist/client/404.html", root)),
    access(new URL("dist/client/robots.txt", root)),
    access(new URL("dist/client/sitemap.xml", root)),
    access(new URL("dist/client/pages.css", root)),
  ]);
});

test("keeps mobile navigation targets accessible", async () => {
  const css = await readFile(new URL("dist/client/styles.css", root), "utf8");
  assert.match(css, /footer>div a\{[^}]*min-height:44px/i);
  assert.match(css, /brand-app-icon[^}]*height:44px/i);
});

test("packages the installable ParkSwap phone app", async () => {
  const app = await readFile(new URL("dist/client/app/index.html", root), "utf8");
  const manifest = JSON.parse(await readFile(new URL("dist/client/app/manifest.webmanifest", root), "utf8"));
  const worker = await readFile(new URL("dist/server/index.js", root), "utf8");

  assert.match(app, /Leave Spot Now/);
  assert.match(app, /Leaving Soon\?/);
  assert.match(app, /Create free account/);
  assert.match(app, /Join as a Spotter/);
  assert.match(app, /No vehicle required/);
  assert.match(app, /vendor\/leaflet\/leaflet\.js/);
  assert.match(app, /View parking alerts/);
  assert.match(app, /Choose a point on the map/);
  assert.match(app, /Enable precise location/);
  assert.match(app, /id="locationMessage"/);
  assert.match(app, /Continue with Google/);
  assert.match(app, /Continue with Apple/);
  assert.match(app, /googleIdentityButton/);
  assert.match(app, /appleIdentityButton/);
  assert.match(app, /Email my secure web password/);
  assert.doesNotMatch(app, /subscription/i);
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.name, "ParkSwap");
  assert.match(worker, /https:\/\/parkswap\.com/);
  await Promise.all([
    access(new URL("dist/client/app/vendor/leaflet/leaflet.js", root)),
    access(new URL("dist/client/app/vendor/leaflet/leaflet.css", root)),
    access(new URL("dist/client/app/vendor/leaflet/images/marker-icon.png", root)),
  ]);
});
