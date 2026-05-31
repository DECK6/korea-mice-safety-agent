import { z } from "zod";

export const MiceEventTypeSchema = z.enum([
  "festival",
  "outdoor_event",
  "exhibition",
  "conference",
  "performance",
  "food_event",
  "vip_event",
]);

export const baseMiceEventInputSchema = z.object({
  eventName: z.string().optional().default("행사명 미정"),
  date: z.string().optional(),
  eventDate: z.string().optional().describe("행사일 YYYY-MM-DD. date와 같은 의미의 alias입니다."),
  location: z.string().optional(),
  organizer: z.string().optional(),
  eventTypes: z.array(MiceEventTypeSchema).optional(),
  venueId: z.string().optional(),
  jurisdiction: z.string().optional(),
  expectedCrowd: z.number().int().min(0).optional(),
  outdoor: z.boolean().optional(),
  outdoorEvent: z.boolean().optional(),
  roadUse: z.boolean().optional(),
  outdoorAdvertising: z.boolean().optional().describe("현수막, 배너, 지주형 안내판, 전광류 등 옥외광고물/외부 안내표지 설치 여부"),
  unhostedCrowd: z.boolean().optional().describe("주최자·주관자 없이 자발적/예측형 다중운집이 발생하는 상황"),
  temporaryStructures: z.boolean().optional(),
  temporaryElectricity: z.boolean().optional(),
  setupTeardown: z.boolean().optional(),
  workAtHeight: z.boolean().optional(),
  heavyObjectHandling: z.boolean().optional(),
  hotWork: z.boolean().optional(),
  lpgUse: z.boolean().optional(),
  foodService: z.boolean().optional(),
  performance: z.boolean().optional(),
  personalDataProcessing: z.boolean().optional(),
  vipSecurity: z.boolean().optional(),
});

export type MiceEventInput = z.infer<typeof baseMiceEventInputSchema>;
export type MiceEventType = z.infer<typeof MiceEventTypeSchema>;
