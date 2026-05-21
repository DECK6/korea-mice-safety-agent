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
    const input = "inputJson" in args
      ? parseInputJson(args.inputJson)
      : args;

    try {
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
    out[key] = coerceArgValue(next);
    i += 1;
  }
  return out;
}

function coerceArgValue(raw: string): unknown {
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (/^[\[{]/.test(raw)) {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  return raw;
}

program.parseAsync(process.argv).catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});

