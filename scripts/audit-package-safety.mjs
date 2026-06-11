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
  // Quote-tolerant on both sides: matches raw .env (KEY=value), JSON ("KEY": "value"),
  // and quoted assignments. The name may be wrapped in quotes; the value may be bare or quoted.
  {
    name: "generic api key assignment",
    pattern:
      /["']?(API_KEY|SERVICE_KEY|SECRET|TOKEN|AUTH_KEY|ACCESS_KEY|PRIVATE_KEY|PASSWORD|FACILITY_KEY|OPENAPI_KEY|APIHUB_KEY)["']?\s*[:=]\s*["']?[A-Za-z0-9._-]{16,}/i,
  },
  // Name-agnostic high-entropy detectors. `entropy: true` runs them per-line so a
  // benign-context filter (etag/hash/checksum) can exclude legitimate content hashes.
  { name: "32-char hex string", pattern: /\b[0-9a-fA-F]{32}\b/, entropy: true },
  {
    name: "uuid v4",
    pattern: /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}\b/,
    entropy: true,
  },
  // serviceKey/service/authKey in URL query strings followed by a long token.
  { name: "service/auth key in url", pattern: /(serviceKey|service|authKey|apiKey)=[A-Za-z0-9._~%+/-]{16,}/i },
];

// Lines whose match sits in an obvious content-hash context are not secrets.
const benignHashContext = /(etag|integrity|sri|checksum|digest|hash|sha\d*|md5|content-hash|fingerprint)/i;

// If a real .env exists at the repo root, load its secret VALUES and scan every
// to-be-published file for any verbatim occurrence (catches accidental pastes in
// any format). Values themselves are never printed.
const envValues = [];
const envPath = join(root, ".env");
if (existsSync(envPath)) {
  const envContent = readFileSync(envPath, "utf8");
  for (const rawLine of envContent.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    let value = line.slice(eq + 1).trim();
    // Strip surrounding quotes and any trailing inline comment.
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    // Only treat sufficiently long values as secrets to avoid false positives on flags.
    if (value.length >= 12) envValues.push(value);
  }
}

for (const path of files) {
  const extension = path.includes(".") ? path.slice(path.lastIndexOf(".")).toLowerCase() : "";
  if (!textExtensions.has(extension)) continue;
  const localPath = join(root, path);
  if (!existsSync(localPath)) continue;
  const content = readFileSync(localPath, "utf8");
  for (const secret of secretPatterns) {
    if (secret.entropy) {
      // Per-line so we can skip lines that are clearly content hashes, not secrets.
      const hit = content
        .split(/\r?\n/)
        .some((line) => secret.pattern.test(line) && !benignHashContext.test(line));
      if (hit) {
        violations.push({ type: "secret_like_content", path, pattern: secret.name });
      }
    } else if (secret.pattern.test(content)) {
      violations.push({ type: "secret_like_content", path, pattern: secret.name });
    }
  }
  for (const value of envValues) {
    if (content.includes(value)) {
      violations.push({ type: "secret_value_leak", path, pattern: "verbatim .env value" });
      break;
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
