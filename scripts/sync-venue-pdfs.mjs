import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

const rootDir = process.cwd();
const manifestPath = path.join(rootDir, "data", "venue-pdf-manifest.json");
const rawDir = path.join(rootDir, "data", "raw", "venue-pdfs");
const rawHwpDir = path.join(rootDir, "data", "raw", "venue-hwp");
const mdDir = path.join(rootDir, "data", "markdown", "venue-manuals");

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

await mkdir(rawDir, { recursive: true });
await mkdir(rawHwpDir, { recursive: true });
await mkdir(mdDir, { recursive: true });

const results = [];

for (const item of manifest.items) {
  const format = item.format ?? "pdf";
  const rawBaseDir = format === "hwp" ? rawHwpDir : rawDir;
  const sourcePath = path.join(rawBaseDir, item.filename);
  const mdPath = path.join(mdDir, `${path.parse(item.filename).name}.md`);

  let downloaded = false;
  let file;
  let sha256 = "";
  let size = 0;
  let text = "";
  let error = "";
  try {
    downloaded = await ensureDocument(item, sourcePath, format);
    file = await readFile(sourcePath);
    sha256 = createHash("sha256").update(file).digest("hex");
    size = (await stat(sourcePath)).size;
    text = extractText(sourcePath, format);
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  if (error) {
    results.push({
      id: item.id,
      venueId: item.venueId,
      downloaded,
      document: path.relative(rootDir, sourcePath),
      markdown: null,
      error,
    });
    continue;
  }

  const markdown = [
    "---",
    `id: ${JSON.stringify(item.id)}`,
    `venueId: ${JSON.stringify(item.venueId)}`,
    `sourceId: ${JSON.stringify(item.sourceId)}`,
    `title: ${JSON.stringify(item.title)}`,
    `sourceUrl: ${JSON.stringify(item.url)}`,
    `format: ${JSON.stringify(format)}`,
    `localDocumentPath: ${JSON.stringify(path.relative(rootDir, sourcePath))}`,
    `sha256: ${JSON.stringify(sha256)}`,
    `bytes: ${size}`,
    `convertedAt: ${JSON.stringify(new Date().toISOString())}`,
    "licenseReview: \"원문 PDF 재배포 전 출처별 이용조건 확인 필요\"",
    "---",
    "",
    `# ${item.title}`,
    "",
    `- Venue: ${item.venueId}`,
    `- Source ID: ${item.sourceId}`,
    `- Source URL: ${item.url}`,
    `- Local Document: ${path.relative(rootDir, sourcePath)}`,
    `- SHA-256: ${sha256}`,
    "",
    "## Extracted Text",
    "",
    text.trim() || "_No extractable text. OCR may be required._",
    "",
  ].join("\n");

  await writeFile(mdPath, markdown, "utf8");
  results.push({
    id: item.id,
    venueId: item.venueId,
    downloaded,
    document: path.relative(rootDir, sourcePath),
    markdown: path.relative(rootDir, mdPath),
    bytes: size,
    sha256,
    chars: text.length,
  });
}

const indexPath = path.join(mdDir, "index.json");
await writeFile(indexPath, `${JSON.stringify({
  generatedAt: new Date().toISOString(),
  count: results.length,
  items: results,
}, null, 2)}\n`, "utf8");

console.log(JSON.stringify({ count: results.length, items: results }, null, 2));

async function ensureDocument(item, sourcePath, format) {
  try {
    const existing = await stat(sourcePath);
    if (existing.size > 0 && await isValidDocument(sourcePath, format)) return false;
  } catch {
    // Missing file is expected on first run.
  }

  const cookiePath = path.join(rawDir, ".download-cookies.txt");
  if (item.referer) {
    spawnSync("curl", [
      "--location",
      "--silent",
      "--show-error",
      "--user-agent",
      "Mozilla/5.0 korea-mice-safety-agent/0.1",
      "--cookie-jar",
      cookiePath,
      item.referer,
    ], { encoding: "utf8" });
  }

  const args = [
    "--location",
    "--fail",
    "--silent",
    "--show-error",
    "--retry",
    "2",
    "--user-agent",
    "Mozilla/5.0 korea-mice-safety-agent/0.1",
  ];
  if (item.referer) {
    args.push("--referer", item.referer, "--cookie", cookiePath, "--cookie-jar", cookiePath);
  }
  args.push(
    "--output",
    sourcePath,
    item.url,
  );

  const res = spawnSync("curl", args, { encoding: "utf8" });

  if (res.status !== 0) {
    throw new Error(`Failed to download ${item.id}: ${res.stderr || res.stdout}`);
  }
  if (!(await isValidDocument(sourcePath, format))) {
    throw new Error(`Downloaded file is not a valid ${format.toUpperCase()} document for ${item.id}`);
  }
  return true;
}

async function isValidDocument(sourcePath, format) {
  try {
    const buf = await readFile(sourcePath);
    if (format === "hwp") return buf.includes(Buffer.from("HWP Document File", "utf8"));
    return buf.subarray(0, 4).toString("utf8") === "%PDF";
  } catch {
    return false;
  }
}

function extractText(sourcePath, format) {
  if (format === "hwp") return extractHwpText(sourcePath);
  return extractPdfText(sourcePath);
}

function extractHwpText(sourcePath) {
  const res = spawnSync("hwp5txt", [sourcePath], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 80,
  });

  if (res.status !== 0) {
    return `hwp5txt failed: ${(res.stderr || res.stdout || "").trim()}`;
  }
  return normalizeText(res.stdout);
}

function extractPdfText(sourcePath) {
  const res = spawnSync("pdftotext", [
    "-layout",
    "-enc",
    "UTF-8",
    sourcePath,
    "-",
  ], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 80,
  });

  if (res.status !== 0) {
    return `pdftotext failed: ${(res.stderr || res.stdout || "").trim()}`;
  }
  return normalizeText(res.stdout);
}

function normalizeText(text) {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n");
}
