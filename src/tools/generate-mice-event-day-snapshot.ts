import { z } from "zod";
import { COMMON_RESPONSE_META } from "../config/constants.js";
import { generateEventDaySnapshot } from "../lib/event-day-snapshot.js";
import type { McpToolResult, ToolDefinition } from "../lib/types.js";

const inputSchema = z.object({
  venueId: z.string().optional(),
  jurisdiction: z.string().optional().describe("예: 서울특별시 서초구, 경기도 고양시"),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  capturedAt: z.string().optional(),
  ttlMinutes: z.number().int().min(1).max(24 * 60).optional().default(30),
  useFixtures: z.boolean().optional().default(false),
  live: z.boolean().optional().default(true),
  seoulAreaName: z.string().optional().describe("서울 실시간 도시데이터 장소명. 예: 강남역, 여의도한강공원"),
  airStationName: z.string().optional().describe("에어코리아 측정소명. 예: 종로구"),
});

async function handler(rawInput: unknown): Promise<McpToolResult> {
  const input = inputSchema.parse(rawInput ?? {});
  const snapshot = await generateEventDaySnapshot(input);
  const text = [
    "# MICE event-day snapshot",
    `- capturedAt: ${snapshot.capturedAt}`,
    `- expiresAt: ${snapshot.expiresAt}`,
    `- isStale: ${snapshot.isStale}`,
    `- location: ${snapshot.location.jurisdiction ?? snapshot.location.venueId ?? "미입력"}`,
    "",
    ...snapshot.sources.map((source) => `- ${source.sourceId}: ${source.status}, records=${source.records?.length ?? 0}${source.warnings.length ? ` / ${source.warnings.join("; ")}` : ""}`),
  ].join("\n");

  return {
    content: [{ type: "text", text }],
    structuredContent: { snapshot, _meta: COMMON_RESPONSE_META },
  };
}

export const generateMiceEventDaySnapshotTool: ToolDefinition = {
  name: "generate_mice_event_day_snapshot",
  title: "MICE 행사 당일 snapshot 생성",
  description:
    "서울 실시간 도시데이터, 에어코리아, ITS, 재난문자 등 P1 source의 snapshot을 생성합니다. live=true이면 준비된 API를 실제 호출하고 missing/pending key는 구조화된 fallback으로 반환합니다.",
  inputSchema,
  handler,
};
