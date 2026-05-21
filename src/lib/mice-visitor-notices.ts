import communicationTemplates from "../ontology/mice/communication-templates.json" with { type: "json" };

export type VisitorNoticeLanguage = "ko" | "en" | "ja" | "zh";

export const DEFAULT_VISITOR_NOTICE_LANGUAGES: VisitorNoticeLanguage[] = ["ko", "en", "ja", "zh"];

export interface LocalizedPlaceholderInput {
  ko?: string;
  en?: string;
  ja?: string;
  zh?: string;
}

export interface VisitorNoticeInput {
  decisionType: string;
  languages?: VisitorNoticeLanguage[];
  eventName: string;
  zone: string;
  reason: string;
  safeRoute: string;
  resumeConditions?: string[];
  contactPoint: string;
  localizedPlaceholders?: {
    eventName?: LocalizedPlaceholderInput;
    zone?: LocalizedPlaceholderInput;
    reason?: LocalizedPlaceholderInput;
    safeRoute?: LocalizedPlaceholderInput;
    contactPoint?: LocalizedPlaceholderInput;
  };
}

export interface VisitorNotice {
  id: string;
  decisionType: string;
  channel: string;
  audience: string;
  tone: string;
  localizations: Partial<Record<VisitorNoticeLanguage, string>>;
  checkpoints: string[];
}

export interface VisitorNoticeBundle {
  markdown: string;
  languages: VisitorNoticeLanguage[];
  notices: Array<VisitorNotice & { scenario: string }>;
}

export interface DefaultVisitorNoticeBundleInput {
  eventName: string;
  venueId?: string;
  roadUse?: boolean;
  outdoor?: boolean;
  outdoorEvent?: boolean;
}

interface CommunicationTemplate {
  id: string;
  decisionType: string;
  channel: string;
  audience: string;
  tone: string;
  ko: string;
  en?: string;
  ja?: string;
  zh?: string;
  checkpoints: string[];
}

const operationCommunicationTemplates = (communicationTemplates as { templates: CommunicationTemplate[] }).templates;

function fillTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? "");
}

export function visitorLanguageLabel(language: VisitorNoticeLanguage): string {
  const labels: Record<VisitorNoticeLanguage, string> = {
    ko: "한국어",
    en: "English",
    ja: "日本語",
    zh: "中文",
  };
  return labels[language];
}

function localizedTemplateSource(template: CommunicationTemplate, language: VisitorNoticeLanguage): string | undefined {
  if (language === "ko") return template.ko;
  return template[language];
}

export function autoLocalizePlaceholder(key: string, value: string, language: VisitorNoticeLanguage): string {
  if (language === "ko") return value;
  const compactValue = value.trim();
  const gateMatch = compactValue.match(/^([A-Za-z0-9]+)\s*게이트$/);
  if (key === "zone" && gateMatch) {
    if (language === "en") return `Gate ${gateMatch[1].toUpperCase()}`;
    if (language === "ja") return `${gateMatch[1].toUpperCase()}ゲート`;
    return `${gateMatch[1].toUpperCase()}号门`;
  }
  const dictionaries: Record<string, Partial<Record<VisitorNoticeLanguage, string>>> = {
    "대기열 병목": { en: "queue congestion", ja: "待機列の混雑", zh: "排队拥堵" },
    "B게이트 병목": { en: "congestion at Gate B", ja: "Bゲートの混雑", zh: "B号门拥堵" },
    "안전 확인 필요": { en: "a safety check is required", ja: "安全確認が必要なため", zh: "需要进行安全确认" },
    "화재 위험": { en: "a fire risk", ja: "火災リスク", zh: "火灾风险" },
    "응급환자 발생": { en: "a medical emergency", ja: "救急対応が必要なため", zh: "发生医疗紧急情况" },
    "기상 악화": { en: "severe weather", ja: "悪天候", zh: "恶劣天气" },
    "인파 밀집": { en: "crowd congestion", ja: "人の密集", zh: "人群拥挤" },
    "지정 대피동선": { en: "designated evacuation route", ja: "指定避難経路", zh: "指定疏散路线" },
    "운영본부": { en: "Event Operations Center", ja: "運営本部", zh: "运营指挥中心" },
    행사: { en: "the event", ja: "イベント", zh: "活动" },
    해당: { en: "the affected", ja: "該当", zh: "相关" },
    "주요 혼잡": { en: "main congestion", ja: "主要混雑", zh: "主要拥挤" },
    "도로 인접": { en: "roadside event", ja: "道路隣接", zh: "道路邻近" },
  };
  return dictionaries[compactValue]?.[language] ?? value;
}

function localizedPlaceholderValue(
  key: string,
  koValue: string,
  language: VisitorNoticeLanguage,
  provided?: LocalizedPlaceholderInput,
): string {
  return provided?.[language] ?? (language === "ko" ? provided?.ko ?? koValue : autoLocalizePlaceholder(key, koValue, language));
}

export function buildMiceVisitorNotices(input: VisitorNoticeInput): {
  languages: VisitorNoticeLanguage[];
  notices: VisitorNotice[];
} {
  const languages = Array.from(new Set<VisitorNoticeLanguage>(
    input.languages && input.languages.length > 0 ? input.languages : DEFAULT_VISITOR_NOTICE_LANGUAGES,
  ));
  const valuesForLanguage = (language: VisitorNoticeLanguage) => {
    const resumeConditionsKo = input.resumeConditions && input.resumeConditions.length > 0
      ? input.resumeConditions.join(", ")
      : "안전 확인 완료";
    return {
      eventName: localizedPlaceholderValue("eventName", input.eventName, language, input.localizedPlaceholders?.eventName),
      zone: localizedPlaceholderValue("zone", input.zone, language, input.localizedPlaceholders?.zone),
      reason: localizedPlaceholderValue("reason", input.reason, language, input.localizedPlaceholders?.reason),
      safeRoute: localizedPlaceholderValue("safeRoute", input.safeRoute, language, input.localizedPlaceholders?.safeRoute),
      resumeConditions: language === "ko" ? resumeConditionsKo : autoLocalizePlaceholder("resumeConditions", resumeConditionsKo, language),
      contactPoint: localizedPlaceholderValue("contactPoint", input.contactPoint, language, input.localizedPlaceholders?.contactPoint),
    };
  };
  const notices = operationCommunicationTemplates
    .filter((template) => template.decisionType === input.decisionType)
    .filter((template) => template.channel === "public_announcement")
    .filter((template) => template.audience === "visitors")
    .map((template) => {
      const localizations = Object.fromEntries(languages
        .map((language) => {
          const source = localizedTemplateSource(template, language);
          return source ? [language, fillTemplate(source, valuesForLanguage(language))] : undefined;
        })
        .filter((entry): entry is [VisitorNoticeLanguage, string] => Boolean(entry)));
      return {
        id: template.id,
        decisionType: template.decisionType,
        channel: template.channel,
        audience: template.audience,
        tone: template.tone,
        localizations,
        checkpoints: template.checkpoints,
      };
    });
  return { languages, notices };
}

export function formatVisitorNoticesMarkdown(
  title: string,
  languages: VisitorNoticeLanguage[],
  notices: VisitorNotice[],
): string {
  return [
    `# ${title}`,
    `- languages: ${languages.map(visitorLanguageLabel).join(", ")}`,
    "",
    notices.length > 0
      ? notices.map((notice) => [
        `## ${notice.id}`,
        `- decisionType: ${notice.decisionType}`,
        ...languages
          .filter((language) => notice.localizations[language])
          .map((language) => [
            `### ${visitorLanguageLabel(language)}`,
            notice.localizations[language],
          ].join("\n")),
        "",
        "체크포인트:",
        ...notice.checkpoints.map((checkpoint) => `- ${checkpoint}`),
      ].join("\n")).join("\n\n")
      : "매칭 방문객 안내 템플릿 없음",
  ].join("\n");
}

const defaultVisitorNoticeScenarios = [
  { scenario: "대피개시", decisionType: "evacuation_start", reason: "안전 확인 필요" },
  { scenario: "행사 일시중지", decisionType: "event_pause", reason: "인파 밀집" },
  { scenario: "행사 중단", decisionType: "event_stop", reason: "안전 확인 필요" },
  { scenario: "현 위치 대기", decisionType: "shelter_in_place", reason: "안전 확인 필요" },
  { scenario: "운영 재개", decisionType: "event_resume", reason: "안전 확인 완료" },
];

export function inferVisitorNoticeZone(input: DefaultVisitorNoticeBundleInput): string {
  if (input.venueId) return "주요 혼잡";
  if (input.roadUse) return "도로 인접";
  if (input.outdoor || input.outdoorEvent) return "주요 혼잡";
  return "해당";
}

export function buildDefaultMiceVisitorNoticeBundle(input: DefaultVisitorNoticeBundleInput): VisitorNoticeBundle {
  const zone = inferVisitorNoticeZone(input);
  const noticeGroups = defaultVisitorNoticeScenarios.map((scenario) => {
    const result = buildMiceVisitorNotices({
      decisionType: scenario.decisionType,
      languages: DEFAULT_VISITOR_NOTICE_LANGUAGES,
      eventName: input.eventName,
      zone,
      reason: scenario.reason,
      safeRoute: "지정 대피동선",
      resumeConditions: ["안전 확인 완료", "대기열 안정", "스태프 배치 확인"],
      contactPoint: "운영본부",
    });
    return {
      scenario: scenario.scenario,
      languages: result.languages,
      notices: result.notices.map((notice) => ({ ...notice, scenario: scenario.scenario })),
    };
  });
  const sections = noticeGroups.map((group) => formatVisitorNoticesMarkdown(group.scenario, group.languages, group.notices));
  return {
    markdown: [
      "# 다국어 방문객 안전 안내문",
      "- 용도: 현장 방송, 안내판, 푸시/SMS 초안",
      "- 언어: 한국어, English, 日本語, 中文",
      "- 주의: 고유 지명, 브랜드명, 환불/입장 정책은 행사 주최자 확정 문구로 최종 교정",
      "",
      ...sections,
    ].join("\n\n"),
    languages: DEFAULT_VISITOR_NOTICE_LANGUAGES,
    notices: noticeGroups.flatMap((group) => group.notices),
  };
}
