// MCP surface: stdio server exposing the same registry as tools (dots become
// underscores) plus the difywf://guide resource. Stable spec subset only:
// tools + resources, no elicitation/sampling/roots.

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { err } from "./core/contract.ts";
import { runTool, tools } from "./tools/registry.ts";
import { guideText } from "./tools/guide.ts";

const mcpName = (n: string): string => n.replaceAll(".", "_");

const server = new Server(
  { name: "difywf", version: "0.1.0" },
  { capabilities: { tools: {}, resources: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: tools.map((t) => ({
    name: mcpName(t.name),
    description: t.summary,
    inputSchema: t.schema as { type: "object"; properties?: Record<string, unknown>; required?: string[] },
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const tool = tools.find((t) => mcpName(t.name) === req.params.name);
  const result = tool
    ? await runTool(tool, (req.params.arguments ?? {}) as Record<string, unknown>, { _surface: "mcp" })
    : err("USAGE_ERROR", `unknown tool '${req.params.name}'`);
  return {
    content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    isError: !result.ok,
  };
});

server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: [
    { uri: "difywf://guide", name: "difywf agent guide", mimeType: "text/markdown", description: "Authoring playbook: golden path, node types, error codes, safety rules" },
  ],
}));

server.setRequestHandler(ReadResourceRequestSchema, async (req) => ({
  contents: [{ uri: req.params.uri, mimeType: "text/markdown", text: guideText("all") }],
}));

await server.connect(new StdioServerTransport());
