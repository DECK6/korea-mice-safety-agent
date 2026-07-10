import { z } from "zod";
import { baseMiceEventInputSchema } from "../lib/mice-event-input-schema.js";
import { buildPersonaSafetyFindings, personaCoverageScore, samplePersonaCohort } from "../lib/mice-personas.js";
import type { McpToolResult, ToolDefinition } from "../lib/types.js";
import { generateMiceSafetyPlanTool } from "./generate-mice-safety-plan.js";
import { PersonaPresetSchema } from "./sample-mice-persona-cohort.js";
import { reviewMiceSafetyPlanTool } from "./review-mice-safety-plan.js";

const inputSchema = baseMiceEventInputSchema.extend({
  personaPreset: PersonaPresetSchema.optional().default("national"),
  cohortSize: z.number().int().min(10).max(200).optional().default(100),
  targetProvince: z.string().optional(),
  personaSeed: z.number().int().optional().default(20260710),
});

async function handler(rawInput: unknown): Promise<McpToolResult> {
  const input = inputSchema.parse(rawInput ?? {});
  const cohort = samplePersonaCohort({
    preset: input.personaPreset,
    cohortSize: input.cohortSize,
    targetProvince: input.targetProvince ?? input.jurisdiction,
    seed: input.personaSeed,
    representativeLimit: 6,
  });
  const eventInput = Object.fromEntries(Object.entries(input).filter(([key]) => ![
    "personaPreset", "cohortSize", "targetProvince", "personaSeed",
  ].includes(key)));
  const generated = await generateMiceSafetyPlanTool.handler({ ...eventInput, output: "structured" });
  const plan = generated.structuredContent ?? {};
  const planMarkdown = String(plan.planMarkdown ?? generated.content[0]?.text ?? "");
  const reviewResult = await reviewMiceSafetyPlanTool.handler({
    ...eventInput,
    planMarkdown,
    documentBundle: plan.documentBundle,
  });
  const review = reviewResult.structuredContent ?? {};
  const findings = buildPersonaSafetyFindings(cohort, planMarkdown, eventInput);
  const score = personaCoverageScore(findings);
  const gaps = findings.filter((finding) => finding.status === "gap");
  const covered = findings.filter((finding) => finding.status === "covered");
  const text = [
    "# MICE 합성 관람객 안전 스트레스 테스트",
    `- 행사: ${input.eventName}`,
    `- 코호트: ${cohort.presetLabel} ${cohort.actualSize}명`,
    `- 기존 문서 커버리지: ${review.score ?? "확인 필요"} (${review.grade ?? "-"})`,
    `- 페르소나 QA 커버리지: ${score}/100`,
    `- 결과: gap=${gaps.length}, covered=${covered.length}`,
    "",
    "> 페르소나 점수는 법적 적합성 또는 실제 사고확률 점수가 아닙니다. 합성 사용자 관점의 계획서 사각지대 점검값입니다.",
    "",
    "## 보완 필요",
    ...(gaps.length > 0
      ? gaps.map((finding) => `- [${finding.priority}] ${finding.title}${finding.sentinel ? " (필수 센티널)" : ""}: ${finding.recommendation}`)
      : ["- 주요 페르소나 QA 공백 없음"]),
    "",
    "## 확인됨",
    ...(covered.length > 0 ? covered.map((finding) => `- ${finding.title}`) : ["- 확인된 항목 없음"]),
  ].join("\n");

  return {
    content: [{ type: "text", text }],
    structuredContent: {
      input,
      cohort,
      basePlanReview: {
        verdict: review.verdict,
        score: review.score,
        grade: review.grade,
        counts: review.counts,
      },
      personaCoverage: {
        score,
        counts: { gap: gaps.length, covered: covered.length, total: findings.length },
        findings,
      },
    },
  };
}

export const stressTestMiceSafetyPlanTool: ToolDefinition = {
  name: "stress_test_mice_safety_plan",
  title: "MICE 합성 관람객 안전 스트레스 테스트",
  description: "기존 안전관리계획서를 Nemotron-Personas-Korea 기반 합성 코호트와 아동·장애·비한국어 센티널 시나리오로 점검합니다. 법령 적용성 판단과 분리된 비법적 QA 도구입니다.",
  inputSchema,
  handler,
};
