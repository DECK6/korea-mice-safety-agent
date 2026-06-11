#!/usr/bin/env node
import { Command } from "commander";
import { findTool, TOOLS, attachMeta } from "./tool-registry.js";
import { toMcpErrorContent } from "./lib/errors.js";
import { SERVER_DESCRIPTION, SERVER_NAME, VERSION } from "./version.js";

const program = new Command();

program.name(SERVER_NAME).description(SERVER_DESCRIPTION).version(VERSION);

program
  .command("serve")
  .description("Start MCP server over stdio")
  .action(async () => {
    await import("./index.js");
  });

program
  .command("web")
  .description("Start local web simulator for MICE safety applicability checklists")
  .option("--host <host>", "Host to bind", process.env.HOST ?? "127.0.0.1")
  .option("-p, --port <port>", "Port to bind", process.env.PORT ?? "4317")
  .action(async (opts: { host?: string; port?: string }) => {
    const port = Number(opts.port ?? 4317);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      // eslint-disable-next-line no-console
      console.error(`Invalid port: ${opts.port}`);
      process.exit(2);
    }
    const { startWebServer } = await import("./web/server.js");
    await startWebServer({ host: opts.host, port });
  });

program
  .command("build-venue-directory")
  .description("KOPIS 공연시설별상세 API를 순회해 오프라인 venue 디렉터리 온톨로지(JSON)를 구축")
  .option("--rows <n>", "페이지당 레코드 수", "100")
  .option("--max-pages <n>", "최대 페이지 수(미지정 시 전체)")
  .option("--out <file>", "출력 온톨로지 JSON", "src/ontology/mice/kopis-venue-directory.json")
  .option("--raw <dir>", "원본 응답 저장 디렉터리(git 제외)", "data/raw/kcisa")
  .action(async (opts: { rows: string; maxPages?: string; out: string; raw: string }) => {
    const { mkdir, writeFile } = await import("node:fs/promises");
    const { dirname, join, resolve } = await import("node:path");
    const { buildVenueDirectory } = await import("./lib/kopis-venue-directory.js");

    const rawDir = resolve(opts.raw);
    await mkdir(rawDir, { recursive: true });

    const directory = await buildVenueDirectory({
      numOfRows: Number(opts.rows),
      maxPages: opts.maxPages ? Number(opts.maxPages) : undefined,
      onRawPage: async (pageNo, xml) => {
        await writeFile(join(rawDir, `facilities-p${String(pageNo).padStart(3, "0")}.xml`), xml, "utf8");
      },
      onProgress: (pageNo, fetched, totalCount) => {
        process.stdout.write(`  page ${pageNo}: ${fetched.toLocaleString("ko-KR")}/${totalCount.toLocaleString("ko-KR")}\n`);
      },
    });

    const outPath = resolve(opts.out);
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, `${JSON.stringify(directory, null, 2)}\n`, "utf8");

    const byCategory = new Map<string, number>();
    for (const venue of directory.venues) {
      byCategory.set(venue.category || "(미분류)", (byCategory.get(venue.category || "(미분류)") ?? 0) + 1);
    }
    const top = [...byCategory.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
    process.stdout.write(`\n완료: ${directory.fetchedCount.toLocaleString("ko-KR")}/${directory.totalCount.toLocaleString("ko-KR")}곳 → ${outPath}\n`);
    process.stdout.write(`분류별: ${top.map(([category, count]) => `${category} ${count}`).join(", ")}\n`);
  });

program
  .command("tools")
  .description("List registered MCP tools")
  .option("--json", "JSON output")
  .action((opts: { json?: boolean }) => {
    const rows = TOOLS.map((tool) => ({
      name: tool.name,
      title: tool.title ?? tool.name,
      description: tool.description,
    }));
    if (opts.json) {
      // eslint-disable-next-line no-console
      console.log(JSON.stringify(rows, null, 2));
      return;
    }
    // eslint-disable-next-line no-console
    console.log(`[${SERVER_NAME} v${VERSION}] ${rows.length} tools\n`);
    for (const row of rows) {
      // eslint-disable-next-line no-console
      console.log(`- ${row.name}: ${row.description}`);
    }
  });

program
  .command("call <toolName>")
  .description("Invoke a tool directly. Use --inputJson '{...}' or --key value pairs.")
  .allowUnknownOption(true)
  .action(async (toolName: string, _opts, cmd) => {
    const tool = findTool(toolName);
    if (!tool) {
      // eslint-disable-next-line no-console
      console.error(`Unknown tool: ${toolName}`);
      process.exit(2);
    }

    const args = parseKeyValueArgs(cmd.args.slice(1));

    try {
      let input: unknown = args;
      if ("inputJson" in args) {
        const otherKeys = Object.keys(args).filter((key) => key !== "inputJson");
        if (otherKeys.length > 0) {
          throw new Error("--inputJson은 다른 --key 플래그와 함께 쓸 수 없습니다");
        }
        input = parseInputJson(args.inputJson);
      }
      // eslint-disable-next-line no-console
      console.log(JSON.stringify(attachMeta(await tool.handler(input)), null, 2));
    } catch (err) {
      // eslint-disable-next-line no-console
      console.log(JSON.stringify(toMcpErrorContent(err), null, 2));
      process.exit(1);
    }
  });

function parseInputJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  return JSON.parse(value);
}

// Keys whose schema type is numeric across registered tools. All-digit values for
// any other key (e.g. venueId, jurisdiction) must stay strings to satisfy z.string().
const NUMERIC_ARG_KEYS = new Set([
  "expectedCrowd",
  "limit",
  "latitude",
  "longitude",
  "ttlMinutes",
  "dueSoonMinutes",
  "nx",
  "ny",
]);

function parseKeyValueArgs(tokens: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = tokens[i + 1];
    if (next === undefined || next.startsWith("--")) {
      out[key] = true;
      continue;
    }
    out[key] = coerceArgValue(key, next);
    i += 1;
  }
  return out;
}

function coerceArgValue(key: string, raw: string): unknown {
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (/^[\[{]/.test(raw)) {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  if (NUMERIC_ARG_KEYS.has(key) && /^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  return raw;
}

program.parseAsync(process.argv).catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
