import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { readStore, type MiceAction, type MiceIssue, type MiceOperationsState } from "./mice-operations-store.js";

export type EventMapState = "critical" | "watch" | "normal";
export type TaskSlaState = "overdue" | "due_soon" | "normal" | "no_sla";

export interface EventLocation {
  source: "venue" | "coords";
  venueId?: string;
  label: string;
  lat: number;
  lng: number;
}

export interface OperationsMapTask {
  kind: "issue" | "action";
  id: string;
  title: string;
  category: string;
  team: string;
  level: string;
  status: string;
  zone?: string;
  dueAt?: string;
  slaState: TaskSlaState;
}

export interface OperationsMapCommandDecision {
  id: string;
  decisionType: string;
  label: string;
  level: string;
  zone?: string;
  reason: string;
  effectiveAt: string;
}

export interface OperationsMapEvent {
  eventName: string;
  state: EventMapState;
  stateReasons: string[];
  issues: {
    open: number;
    total: number;
    bySeverity: Record<"critical" | "high" | "medium" | "low", number>;
  };
  actions: { open: number; total: number };
  sla: { worst: TaskSlaState; overdue: number; dueSoon: number };
  runsheet: { done: number; total: number; open: number; blocked: number; escalated: number };
  activeCommandDecisions: OperationsMapCommandDecision[];
  tasks: OperationsMapTask[];
  lastActivityAt: string | null;
  location: EventLocation | null;
}

// Display coordinates only. Each point is the commonly cited centre of the venue — close enough to
// place a marker, not a surveyed position. Never used for distance, capacity or density math. A
// venue that is not listed here has to be pinned with explicit lat/lng instead of being guessed.
export const VENUE_DISPLAY_COORDS: Record<string, { label: string; lat: number; lng: number }> = {
  coex: { label: "코엑스", lat: 37.5118, lng: 127.0592 },
  kintex: { label: "킨텍스", lat: 37.6683, lng: 126.7449 },
  bexco: { label: "벡스코", lat: 35.1691, lng: 129.1360 },
  kdjcenter: { label: "김대중컨벤션센터", lat: 35.1466, lng: 126.9220 },
  songdo_convensia: { label: "송도컨벤시아", lat: 37.3886, lng: 126.6390 },
  suwon_convention_center: { label: "수원컨벤션센터", lat: 37.2860, lng: 127.0555 },
  ceco: { label: "창원컨벤션센터(CECO)", lat: 35.2225, lng: 128.6811 },
};

export const OPERATIONS_MAP_EMPTY_NOTE =
  "등록된 행사가 없습니다. MCP 도구(register_mice_safety_issue, initialize_mice_runsheet_execution)로 이슈·런시트를 등록하면 지도에 나타납니다.";

export const OPERATIONS_MAP_DISCLAIMER =
  "이 상황판은 로컬 운영 저장소에 기록된 이슈·조치·런시트·지휘판단만 집계합니다. 표시 좌표는 지점 식별용 근사값이며, 중지·대피·입장제한 결정은 현장 책임자 판단과 관계기관 협의로 확정하세요.";

const LOCATIONS_FILE = "event-locations.json";
const DEFAULT_DUE_SOON_MINUTES = 15;
const TASK_LIMIT = 8;
const CLOSED_ISSUE_STATUS = ["resolved", "verified"];
const CLOSED_ACTION_STATUS = ["completed", "cancelled"];
// The four decision types the store treats as holding an event open; the first two stop or empty
// the venue outright, so they alone raise the board to critical.
const ACTIVE_DECISION_TYPES = ["evacuation_start", "shelter_in_place", "event_pause", "event_stop"];
const STOPPING_DECISION_TYPES = ["evacuation_start", "event_stop"];

const DECISION_LABELS: Record<string, string> = {
  monitor_only: "관찰 강화",
  evacuation_start: "대피개시",
  shelter_in_place: "현 위치 대기",
  event_pause: "행사 일시중지",
  event_stop: "행사 중단",
  event_resume: "행사 재개승인",
  all_clear: "상황해제",
};

const SLA_RANK: Record<TaskSlaState, number> = { overdue: 0, due_soon: 1, normal: 2, no_sla: 3 };
const STATE_RANK: Record<EventMapState, number> = { critical: 0, watch: 1, normal: 2 };

// Mirrors mice-operations-store's storeDir(). event-locations.json is a cosmetic pin file that sits
// beside operations.json but deliberately outside its hash chain, so it is written directly here.
function localDir(): string {
  return process.env.MICE_LOCAL_DIR ?? join(homedir(), ".korea-mice-safety-agent");
}

function locationsPath(): string {
  return join(localDir(), LOCATIONS_FILE);
}

interface StoredLocation {
  venueId?: string;
  lat?: number;
  lng?: number;
  label?: string;
  updatedAt?: string;
}

type StoredLocations = Record<string, StoredLocation>;

function readStoredLocations(): { locations: StoredLocations; warning: string | null } {
  let raw: string;
  try {
    raw = readFileSync(locationsPath(), "utf8");
  } catch {
    return { locations: {}, warning: null };
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("not an object");
    }
    return { locations: parsed as StoredLocations, warning: null };
  } catch {
    // A pin file is cosmetic: a damaged one must not take the situation board down with it.
    return {
      locations: {},
      warning: `${locationsPath()} 를 읽지 못해 모든 행사를 위치 미지정으로 표시합니다. 파일을 지우고 위치를 다시 지정하세요.`,
    };
  }
}

function writeStoredLocations(locations: StoredLocations): void {
  const dir = localDir();
  mkdirSync(dir, { recursive: true });
  const serialized = `${JSON.stringify(locations, null, 2)}\n`;
  const tmpPath = join(dir, `${LOCATIONS_FILE}.tmp-${process.pid}-${Date.now()}`);
  const fd = openSync(tmpPath, "w");
  try {
    writeFileSync(fd, serialized);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmpPath, locationsPath());
}

function resolveLocation(entry: StoredLocation | undefined): EventLocation | null {
  if (!entry) return null;
  if (entry.venueId) {
    const venue = VENUE_DISPLAY_COORDS[entry.venueId];
    // An unknown venueId (an older pin, a renamed venue) is reported as unlocated rather than
    // dropped on the map at a made-up point.
    if (!venue) return null;
    return {
      source: "venue",
      venueId: entry.venueId,
      label: entry.label?.trim() || venue.label,
      lat: venue.lat,
      lng: venue.lng,
    };
  }
  if (!Number.isFinite(entry.lat) || !Number.isFinite(entry.lng)) return null;
  return {
    source: "coords",
    label: entry.label?.trim() || "지정 좌표",
    lat: Number(entry.lat),
    lng: Number(entry.lng),
  };
}

function slaStateFor(dueAt: string | undefined, nowMs: number, dueSoonMs: number): TaskSlaState {
  if (!dueAt) return "no_sla";
  const dueMs = new Date(dueAt).getTime();
  if (!Number.isFinite(dueMs)) return "no_sla";
  if (dueMs < nowMs) return "overdue";
  if (dueMs <= nowMs + dueSoonMs) return "due_soon";
  return "normal";
}

function worstSla(states: TaskSlaState[]): TaskSlaState {
  return states.reduce<TaskSlaState>((worst, state) => (SLA_RANK[state] < SLA_RANK[worst] ? state : worst), "no_sla");
}

function latest(values: Array<string | undefined>): string | null {
  const usable = values.filter((value): value is string => Boolean(value));
  if (usable.length === 0) return null;
  return usable.reduce((newest, value) => (value > newest ? value : newest));
}

function issueTask(issue: MiceIssue, nowMs: number, dueSoonMs: number): OperationsMapTask {
  return {
    kind: "issue",
    id: issue.id,
    title: issue.description,
    category: issue.issueType,
    team: issue.recommendedTeam ?? "미지정",
    level: issue.dispatchPriority ?? issue.severity,
    status: issue.status,
    zone: issue.zone,
    dueAt: issue.firstResponseDueAt,
    slaState: slaStateFor(issue.firstResponseDueAt, nowMs, dueSoonMs),
  };
}

function actionTask(action: MiceAction, nowMs: number, dueSoonMs: number): OperationsMapTask {
  return {
    kind: "action",
    id: action.id,
    title: action.title,
    category: "조치",
    team: action.team ?? action.assignee,
    level: action.priority,
    status: action.status,
    dueAt: action.dueAt,
    slaState: slaStateFor(action.dueAt, nowMs, dueSoonMs),
  };
}

function sortTasks(tasks: OperationsMapTask[]): OperationsMapTask[] {
  return tasks.sort((a, b) => {
    if (SLA_RANK[a.slaState] !== SLA_RANK[b.slaState]) return SLA_RANK[a.slaState] - SLA_RANK[b.slaState];
    return String(a.dueAt ?? "").localeCompare(String(b.dueAt ?? ""));
  });
}

function buildEvent(
  eventName: string,
  state: MiceOperationsState,
  locations: StoredLocations,
  nowMs: number,
  dueSoonMs: number,
): OperationsMapEvent {
  const issues = state.issues.filter((issue) => issue.eventName === eventName);
  const openIssues = issues.filter((issue) => !CLOSED_ISSUE_STATUS.includes(issue.status));
  const issueIds = new Set(issues.map((issue) => issue.id));
  const actions = state.actions.filter((action) => issueIds.has(action.issueId));
  const openActions = actions.filter((action) => !CLOSED_ACTION_STATUS.includes(action.status));
  const runsheetItems = state.runsheetItems.filter((item) => item.eventName === eventName);
  const decisions = state.commandDecisions.filter((decision) => decision.eventName === eventName);
  const activeDecisions = decisions
    .filter((decision) => decision.status === "active" && ACTIVE_DECISION_TYPES.includes(decision.decisionType))
    .sort((a, b) => b.effectiveAt.localeCompare(a.effectiveAt));

  const bySeverity = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const issue of openIssues) bySeverity[issue.severity] += 1;

  const openTasks = sortTasks([
    ...openIssues.map((issue) => issueTask(issue, nowMs, dueSoonMs)),
    ...openActions.map((action) => actionTask(action, nowMs, dueSoonMs)),
  ]);
  // SLA counts cover issues and actions alike: both carry a due time and both show up in the task
  // strip, so a board that counted only issues would understate what is actually late.
  const overdue = openTasks.filter((task) => task.slaState === "overdue").length;
  const dueSoon = openTasks.filter((task) => task.slaState === "due_soon").length;

  const runsheet = {
    total: runsheetItems.length,
    done: runsheetItems.filter((item) => item.status === "done").length,
    open: runsheetItems.filter((item) => item.status === "open").length,
    blocked: runsheetItems.filter((item) => item.status === "blocked").length,
    escalated: runsheetItems.filter((item) => item.status === "escalated").length,
  };

  const stoppingDecision = activeDecisions.find((decision) => STOPPING_DECISION_TYPES.includes(decision.decisionType));
  const criticalOverdue = openIssues.some((issue) => issue.severity === "critical"
    && slaStateFor(issue.firstResponseDueAt, nowMs, dueSoonMs) === "overdue");

  const reasons: string[] = [];
  let eventState: EventMapState = "normal";
  if (stoppingDecision) {
    eventState = "critical";
    reasons.push(`활성 지휘판단 ${DECISION_LABELS[stoppingDecision.decisionType] ?? stoppingDecision.decisionType}`);
  }
  if (criticalOverdue) {
    eventState = "critical";
    reasons.push("critical 이슈 SLA 초과");
  }
  if (eventState !== "critical") {
    if (activeDecisions.length > 0) {
      eventState = "watch";
      reasons.push(`활성 지휘판단 ${DECISION_LABELS[activeDecisions[0].decisionType] ?? activeDecisions[0].decisionType}`);
    }
    if (runsheet.blocked + runsheet.escalated > 0) {
      eventState = "watch";
      reasons.push(`런시트 막힘 ${runsheet.blocked + runsheet.escalated}건`);
    }
    if (overdue > 0) {
      eventState = "watch";
      reasons.push(`SLA 초과 ${overdue}건`);
    }
    if (dueSoon > 0) {
      eventState = "watch";
      reasons.push(`SLA 임박 ${dueSoon}건`);
    }
    if (bySeverity.high > 0) {
      eventState = "watch";
      reasons.push(`high 이슈 ${bySeverity.high}건`);
    }
  }

  return {
    eventName,
    state: eventState,
    stateReasons: reasons,
    issues: { open: openIssues.length, total: issues.length, bySeverity },
    actions: { open: openActions.length, total: actions.length },
    sla: { worst: worstSla(openTasks.map((task) => task.slaState)), overdue, dueSoon },
    runsheet,
    activeCommandDecisions: activeDecisions.map((decision) => ({
      id: decision.id,
      decisionType: decision.decisionType,
      label: DECISION_LABELS[decision.decisionType] ?? decision.decisionType,
      level: decision.level,
      zone: decision.zone,
      reason: decision.reason,
      effectiveAt: decision.effectiveAt,
    })),
    tasks: openTasks.slice(0, TASK_LIMIT),
    lastActivityAt: latest([
      ...issues.map((issue) => issue.updatedAt),
      ...issues.map((issue) => issue.recordedAt),
      ...actions.map((action) => action.assignedAt),
      ...actions.map((action) => action.completedAt),
      ...decisions.map((decision) => decision.recordedAt),
      ...decisions.map((decision) => decision.effectiveAt),
      ...runsheetItems.map((item) => item.updatedAt),
    ]),
    location: resolveLocation(locations[eventName]),
  };
}

export interface OperationsMapPayload {
  generatedAt: string;
  dueSoonMinutes: number;
  events: OperationsMapEvent[];
  unlocatedEvents: string[];
  venueOptions: Array<{ id: string; label: string; lat: number; lng: number }>;
  summary: { events: number; located: number; critical: number; watch: number; overdue: number; dueSoon: number };
  warnings: string[];
  emptyNote: string;
  disclaimer: string;
  storeDir: string;
}

export function buildOperationsMap(options: { now?: string; dueSoonMinutes?: number } = {}): OperationsMapPayload {
  const snapshot = readStore();
  const now = options.now ?? new Date().toISOString();
  const nowMs = new Date(now).getTime();
  const dueSoonMinutes = options.dueSoonMinutes ?? DEFAULT_DUE_SOON_MINUTES;
  const { locations, warning } = readStoredLocations();

  const eventNames = new Set<string>();
  for (const issue of snapshot.state.issues) eventNames.add(issue.eventName);
  for (const decision of snapshot.state.commandDecisions) eventNames.add(decision.eventName);
  for (const item of snapshot.state.runsheetItems) eventNames.add(item.eventName);

  const events = Array.from(eventNames)
    .map((eventName) => buildEvent(eventName, snapshot.state, locations, nowMs, dueSoonMinutes * 60_000))
    .sort((a, b) => {
      if (STATE_RANK[a.state] !== STATE_RANK[b.state]) return STATE_RANK[a.state] - STATE_RANK[b.state];
      if (a.sla.overdue !== b.sla.overdue) return b.sla.overdue - a.sla.overdue;
      return a.eventName.localeCompare(b.eventName, "ko");
    });

  return {
    generatedAt: now,
    dueSoonMinutes,
    events,
    unlocatedEvents: events.filter((event) => !event.location).map((event) => event.eventName),
    venueOptions: Object.entries(VENUE_DISPLAY_COORDS).map(([id, venue]) => ({ id, ...venue })),
    summary: {
      events: events.length,
      located: events.filter((event) => event.location).length,
      critical: events.filter((event) => event.state === "critical").length,
      watch: events.filter((event) => event.state === "watch").length,
      overdue: events.reduce((total, event) => total + event.sla.overdue, 0),
      dueSoon: events.reduce((total, event) => total + event.sla.dueSoon, 0),
    },
    warnings: warning ? [warning] : [],
    emptyNote: OPERATIONS_MAP_EMPTY_NOTE,
    disclaimer: OPERATIONS_MAP_DISCLAIMER,
    storeDir: snapshot.dir,
  };
}

export const eventLocationInputSchema = z.object({
  eventName: z.string().min(1),
  venueId: z.string().min(1).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  label: z.string().min(1).optional(),
}).superRefine((value, ctx) => {
  if (value.venueId !== undefined) {
    if (!VENUE_DISPLAY_COORDS[value.venueId]) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["venueId"],
        message: `표시 좌표가 등록되지 않은 베뉴입니다: ${value.venueId}`,
      });
    }
    return;
  }
  if (typeof value.lat !== "number" || typeof value.lng !== "number") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "venueId 또는 lat/lng 좌표 중 하나는 지정해야 합니다.",
    });
  }
});

export function saveEventLocation(rawInput: unknown): { eventName: string; location: EventLocation } {
  const input = eventLocationInputSchema.parse(rawInput ?? {});
  const { locations } = readStoredLocations();
  const entry: StoredLocation = input.venueId
    ? { venueId: input.venueId, label: input.label, updatedAt: new Date().toISOString() }
    : { lat: input.lat, lng: input.lng, label: input.label, updatedAt: new Date().toISOString() };
  locations[input.eventName] = entry;
  writeStoredLocations(locations);
  const location = resolveLocation(entry);
  if (!location) throw new Error(`위치를 확정하지 못했습니다: ${input.eventName}`);
  return { eventName: input.eventName, location };
}
