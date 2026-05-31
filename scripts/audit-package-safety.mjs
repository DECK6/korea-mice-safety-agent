import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const output = execFileSync("npm", ["pack", "--dry-run", "--json"], {
  cwd: root,
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
});

const pack = JSON.parse(output)[0];
const files = pack.files.map((file) => file.path);

const forbiddenPathPatterns = [
  /^data\/raw\//,
  /^data\/out-of-scope\//,
  /^data\/\.validation-store\//,
  /^data\/markdown\/venue-manuals\//,
  /^node_modules\//,
  /(^|\/)\.env($|\.)/,
  /cookie/i,
  /\.(pdf|hwp|hwpx)$/i,
];

const requiredFiles = [
  "data/public/venue-safety-summaries.json",
  "data/markdown/public/venue-safety-summaries.md",
  "build/ontology/mice/venue-safety-rules.json",
  "build/ontology/mice/venue-facility-index.json",
];

const violations = [];

for (const path of files) {
  for (const pattern of forbiddenPathPatterns) {
    if (pattern.test(path)) {
      violations.push({ type: "forbidden_path", path, pattern: String(pattern) });
      break;
    }
  }
}

for (const path of requiredFiles) {
  if (!files.includes(path)) {
    violations.push({ type: "missing_required_file", path });
  }
}

const textExtensions = new Set([".js", ".ts", ".json", ".md", ".txt", ".yml", ".yaml"]);
const secretPatterns = [
  { name: "LAW_OC assignment", pattern: /LAW_OC\s*=\s*['"]?[A-Za-z0-9_-]{8,}/ },
  { name: "generic api key assignment", pattern: /(API_KEY|SERVICE_KEY|SECRET|TOKEN)\s*[:=]\s*['"][A-Za-z0-9._-]{20,}/i },
];

for (const path of files) {
  const extension = path.includes(".") ? path.slice(path.lastIndexOf(".")).toLowerCase() : "";
  if (!textExtensions.has(extension)) continue;
  const localPath = join(root, path);
  if (!existsSync(localPath)) continue;
  const content = readFileSync(localPath, "utf8");
  for (const secret of secretPatterns) {
    if (secret.pattern.test(content)) {
      violations.push({ type: "secret_like_content", path, pattern: secret.name });
    }
  }
}

const summary = {
  package: pack.name,
  version: pack.version,
  entryCount: files.length,
  unpackedSize: pack.unpackedSize,
  checkedForbiddenPatterns: forbiddenPathPatterns.map(String),
  requiredFiles,
  violations,
};

if (violations.length) {
  console.error(JSON.stringify(summary, null, 2));
  process.exit(1);
}

console.log(JSON.stringify(summary, null, 2));
