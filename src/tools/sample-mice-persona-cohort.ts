import { z } from "zod";
import { PERSONA_PRESETS, samplePersonaCohort } from "../lib/mice-personas.js";
import type { McpToolResult, ToolDefinition } from "../lib/types.js";

export const PersonaPresetSchema = z.enum([
  "national",
  "host_region",
  "senior_inclusive",
  "family_inclusive",
  "operations_workforce",
]);

export const personaCohortInputSchema = z.object({
  preset: PersonaPresetSchema.optional().default("national"),
  cohortSize: z.number().int().min(10).max(200).optional().default(100),
  targetProvince: z.string().optional().describe("개최 지역 중심 프리셋의 시도. 예: 경기, 경기도, 제주특별자치도"),
  seed: z.number().int().optional().default(20260710),
  representativeLimit: z.number().int().min(0).max(12).optional().default(6),
});

async function handler(rawInput: unknown): Promise<McpToolResult> {
  const input = personaCohortInputSchema.parse(rawInput ?? {});
  const cohort = samplePersonaCohort(input);
  const text = [
    "# 합성 관람객 코호트",
    `- 프리셋: ${cohort.presetLabel} (${cohort.preset})`,
    `- 크기: ${cohort.actualSize}명 / seed=${cohort.seed}`,
    `- 고령층: ${cohort.counts.senior}명 (${Math.round(cohort.shares.senior * 100)}%)`,
    `- 가족·보호자 조정 신호: ${cohort.counts.familyCoordination}명 (${Math.round(cohort.shares.familyCoordination * 100)}%)`,
    `- 쉬운 한국어 지원 신호: ${cohort.counts.plainLanguageSupport}명 (${Math.round(cohort.shares.plainLanguageSupport * 100)}%)`,
    "",
    "> 이 코호트는 합성 안전계획 QA용이며 실제 참석자 구성, 행동, 의료 위험 또는 사고 확률을 예측하지 않습니다.",
    "",
    "## 계획 신호",
    ...cohort.planningSignals.map((signal) => `- ${signal.label}: ${signal.count}명 — ${signal.rationale}`),
    ...(cohort.warnings.length > 0 ? ["", "## 경고", ...cohort.warnings.map((warning) => `- ${warning}`)] : []),
  ].join("\n");
  return { content: [{ type: "text", text }], structuredContent: { input, cohort, presets: PERSONA_PRESETS } };
}

export const sampleMicePersonaCohortTool: ToolDefinition = {
  name: "sample_mice_persona_cohort",
  title: "한국형 합성 관람객 코호트 샘플",
  description: "Nemotron-Personas-Korea 소형 비식별 샘플에서 전국/개최지역/고령층/가족/현장작업자 코호트를 구성합니다. 실제 참석자·행동·의료 예측에는 사용할 수 없습니다.",
  inputSchema: personaCohortInputSchema,
  handler,
};
