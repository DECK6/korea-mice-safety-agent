import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { z } from "zod";
import type { McpToolResult, ToolDefinition } from "./lib/types.js";
import { toMcpErrorContent } from "./lib/errors.js";
import { COMMON_RESPONSE_META } from "./config/constants.js";
import { collectMiceP0ReadySourcesTool } from "./tools/collect-mice-p0-ready-sources.js";
import { exportMiceSafetyPlanBundleTool } from "./tools/export-mice-safety-plan-bundle.js";
import { generateMiceEventDaySnapshotTool } from "./tools/generate-mice-event-day-snapshot.js";
import { generateMiceSafetyPlanTool } from "./tools/generate-mice-safety-plan.js";
import { listMiceDutiesTool } from "./tools/list-mice-duties.js";
import { listMiceLawsTool } from "./tools/list-mice-laws.js";
import {
  assignMiceStaffActionTool,
  completeMiceActionTool,
  exportMiceOperationsDashboardTool,
  generateMiceIncidentReportTool,
  generateMiceSituationBriefTool,
  generateMiceVisitorNoticeTool,
  initializeMiceRunsheetExecutionTool,
  queryMiceCommunicationTemplatesTool,
  queryMiceOperationsDashboardTool,
  queryMiceRunsheetExecutionTool,
  recordMiceEvidenceTool,
  recordMiceCommandDecisionTool,
  registerMiceSafetyIssueTool,
  resolveMiceCommandDecisionTool,
  updateMiceRunsheetExecutionTool,
} from "./tools/mice-operations.js";
import { planKoreanLawMcpQueriesTool } from "./tools/plan-korean-law-mcp-queries.js";
import { queryMiceApiAccessStatusTool } from "./tools/query-mice-api-access-status.js";
import { queryMiceHazardControlsTool } from "./tools/query-mice-hazard-controls.js";
import { queryMiceLegalAnnexesTool } from "./tools/query-mice-legal-annexes.js";
import { queryMiceLegalArticlesTool } from "./tools/query-mice-legal-articles.js";
import { queryMiceLocalOrdinancesTool } from "./tools/query-mice-local-ordinances.js";
import { queryMiceLiveOperationsStatusTool } from "./tools/query-mice-live-operations-status.js";
import { queryMiceSafetyApplicabilityTool } from "./tools/query-mice-safety-applicability.js";
import { queryMiceVenueSafetyRulesTool } from "./tools/query-mice-venue-safety-rules.js";
import { queryPerformanceVenuesTool } from "./tools/query-performance-venues.js";
import { queryMiceWorkerSafetyReferencesTool } from "./tools/query-mice-worker-safety-references.js";
import { reviewMiceSafetyPlanTool } from "./tools/review-mice-safety-plan.js";

export const TOOLS: ToolDefinition[] = [
  queryMiceApiAccessStatusTool,
  collectMiceP0ReadySourcesTool,
  generateMiceEventDaySnapshotTool,
  queryMiceLiveOperationsStatusTool,
  queryMiceSafetyApplicabilityTool,
  generateMiceSafetyPlanTool,
  exportMiceSafetyPlanBundleTool,
  reviewMiceSafetyPlanTool,
  queryMiceLocalOrdinancesTool,
  queryMiceWorkerSafetyReferencesTool,
  queryMiceVenueSafetyRulesTool,
  queryPerformanceVenuesTool,
  registerMiceSafetyIssueTool,
  recordMiceEvidenceTool,
  recordMiceCommandDecisionTool,
  resolveMiceCommandDecisionTool,
  assignMiceStaffActionTool,
  completeMiceActionTool,
  generateMiceIncidentReportTool,
  generateMiceSituationBriefTool,
  generateMiceVisitorNoticeTool,
  initializeMiceRunsheetExecutionTool,
  updateMiceRunsheetExecutionTool,
  queryMiceRunsheetExecutionTool,
  queryMiceOperationsDashboardTool,
  exportMiceOperationsDashboardTool,
  queryMiceCommunicationTemplatesTool,
  listMiceLawsTool,
  queryMiceLegalArticlesTool,
  queryMiceLegalAnnexesTool,
  listMiceDutiesTool,
  queryMiceHazardControlsTool,
  planKoreanLawMcpQueriesTool,
];

export function findTool(name: string): ToolDefinition | undefined {
  return TOOLS.find((tool) => tool.name === name);
}

export function attachMeta(result: McpToolResult): McpToolResult {
  return {
    ...result,
    structuredContent: {
      ...(result.structuredContent ?? {}),
      _meta: {
        ...COMMON_RESPONSE_META,
        ...((result.structuredContent?._meta as Record<string, unknown> | undefined) ?? {}),
      },
    },
  };
}

export function registerAllTools(server: McpServer): void {
  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      {
        title: tool.title ?? tool.name,
        description: tool.description,
        inputSchema: extractRawShape(tool.inputSchema),
      },
      async (input: unknown) => {
        try {
          return attachMeta(await tool.handler(input));
        } catch (err) {
          return toMcpErrorContent(err);
        }
      },
    );
  }
}

function extractRawShape(schema: unknown): z.ZodRawShape {
  let cur: unknown = schema;
  for (let i = 0; i < 3; i += 1) {
    if (cur && typeof cur === "object" && "_def" in cur) {
      const def = (cur as { _def?: { schema?: unknown; typeName?: string } })._def;
      if (def?.typeName === "ZodEffects" && def.schema) {
        cur = def.schema;
        continue;
      }
    }
    break;
  }
  if (cur && typeof cur === "object" && "shape" in cur) {
    return (cur as { shape: z.ZodRawShape }).shape;
  }
  return {} as z.ZodRawShape;
}
