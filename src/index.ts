#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerAllTools } from "./tool-registry.js";
import { SERVER_DESCRIPTION, SERVER_NAME, VERSION } from "./version.js";

async function main(): Promise<void> {
  const server = new McpServer(
    {
      name: SERVER_NAME,
      version: VERSION,
    },
    {
      instructions: SERVER_DESCRIPTION,
      capabilities: { tools: {} },
    },
  );

  registerAllTools(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // stdout is reserved for MCP protocol frames.
  // eslint-disable-next-line no-console
  console.error(`[${SERVER_NAME}] v${VERSION} stdio ready`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(`[${SERVER_NAME}] fatal:`, err);
  process.exit(1);
});

