// The live dashboard's map must keep working on a venue network with no outbound access, so
// Leaflet is served from this package instead of a CDN. tsc only emits .js/.d.ts, so the dist
// assets are copied into build/web/vendor/ here, where the server's /vendor/ route serves them.
import { access, cp, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = join(root, "node_modules", "leaflet", "dist");
const target = join(root, "build", "web", "vendor", "leaflet");

// leaflet.css references images/layers.png and images/marker-*.png by relative path, so the
// image directory travels with the stylesheet.
const ASSETS = ["leaflet.js", "leaflet.css", "images"];

try {
  await access(source);
} catch {
  throw new Error(`leaflet dist not found at ${source} — run 'npm install' before 'npm run build'`);
}

await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
for (const asset of ASSETS) {
  await cp(join(source, asset), join(target, asset), { recursive: true });
}

// eslint-disable-next-line no-console
console.log(`[copy-web-vendor] leaflet → ${target}`);
