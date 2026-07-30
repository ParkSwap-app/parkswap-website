import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../static/app/app.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../static/app/index.html", import.meta.url), "utf8");

assert.match(app, /parking\/activity-zones/);
assert.match(app, /state\.activityZones/);
assert.match(app, /L\.circle/);
assert.match(app, /Approximate community density from anonymized ParkSwap activity/);
assert.match(html, /Hot zone · area activity/);
assert.doesNotMatch(app, /historical.*full_name|historical.*email/i);

console.log("ParkSwap community-zone web contract passed.");
