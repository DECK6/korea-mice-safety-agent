import type { z } from "zod";

export interface McpTextContent {
  type: "text";
  text: string;
}

export interface McpToolResult {
  content: McpTextContent[];
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ToolDefinition {
  name: string;
  title?: string;
  description: string;
  inputSchema: z.ZodTypeAny;
  handler: (input: unknown) => Promise<McpToolResult> | McpToolResult;
}

export type Strictness =
  | "statutory_required"
  | "administrative_rule"
  | "local_required"
  | "venue_required"
  | "common_best_practice"
  | "needs_review";

export type VerificationStatus =
  | "verified"
  | "article_verified"
  | "threshold_structured"
  | "needs_review"
  | "summary_only"
  | "obsolete_candidate"
  | "law_verified"
  | "source_verified"
  | "needs_article_review"
  | "needs_source_review"
  | "offline_derived"
  | "todo";
