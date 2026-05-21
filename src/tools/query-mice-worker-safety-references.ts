import { z } from "zod";
import { COMMON_RESPONSE_META } from "../config/constants.js";
import type { McpToolResult, ToolDefinition } from "../lib/types.js";
import { MICE_DATA } from "../lib/mice-data.js";

const inputSchema = z.object({
  kind: z.enum(["law_article", "kosha_guide"]).optional(),
  dutyId: z.string().optional().describe("예: worker_safety_work_plan"),
  hazardId: z.string().optional().describe("예: worker_fall_height, heavy_object_handling"),
  query: z.string().optional().describe("제목/요약/적용조건 부분 검색어"),
});

async function handler(rawInput: unknown): Promise<McpToolResult> {
  const input = inputSchema.parse(rawInput ?? {});
  const query = input.query?.trim().toLocaleLowerCase("ko");
  const references = MICE_DATA.workerSafetyReferences.filter((ref) => {
    if (input.kind && ref.kind !== input.kind) return false;
    if (input.dutyId && !ref.relatedDutyIds.includes(input.dutyId)) return false;
    if (input.hazardId && !ref.relatedHazardIds.includes(input.hazardId)) return false;
    if (query) {
      const haystack = `${ref.title} ${ref.appliesWhen} ${ref.summary}`.toLocaleLowerCase("ko");
      if (!haystack.includes(query)) return false;
    }
    return true;
  });

  const text = [
    "# MICE 작업자 안전/KOSHA 근거",
    references.length > 0
      ? references.map((ref) => [
        `## ${ref.title} (${ref.id})`,
        `- 구분: ${ref.kind}`,
        `- 적용: ${ref.appliesWhen}`,
        `- 요약: ${ref.summary}`,
        `- 관련 의무: ${ref.relatedDutyIds.join(", ")}`,
        `- 관련 위험: ${ref.relatedHazardIds.join(", ")}`,
        `- 오프라인 출처: ${ref.offlineSourcePath}`,
      ].join("\n")).join("\n")
      : "매칭 근거 없음",
  ].join("\n");

  return {
    content: [{ type: "text", text }],
    structuredContent: { input, references, _meta: COMMON_RESPONSE_META },
  };
}

export const queryMiceWorkerSafetyReferencesTool: ToolDefinition = {
  name: "query_mice_worker_safety_references",
  title: "MICE 작업자 안전/KOSHA 근거 조회",
  description:
    "MICE 설치·철거 작업자 안전 레이어로 정리한 산안기준규칙/KOSHA 로컬 근거를 조회합니다.",
  inputSchema,
  handler,
};
