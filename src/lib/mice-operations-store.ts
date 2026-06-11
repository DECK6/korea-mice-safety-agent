import { appendFileSync, copyFileSync, existsSync, mkdirSync, openSync, fsyncSync, closeSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { VERSION } from "../version.js";

export type IssueStatus = "open" | "assigned" | "in_progress" | "resolved" | "verified";
export type ActionStatus = "assigned" | "in_progress" | "completed" | "cancelled";
export type CommandDecisionType = "monitor_only" | "evacuation_start" | "shelter_in_place" | "event_pause" | "event_stop" | "event_resume" | "all_clear";
export type CommandDecisionStatus = "active" | "released" | "superseded" | "informational";
export type RunsheetStatus = "open" | "done" | "blocked" | "escalated";

export interface MiceIssue {
  id: string;
  eventName: string;
  issueType: string;
  severity: "low" | "medium" | "high" | "critical";
  status: IssueStatus;
  description: string;
  venueId?: string;
  jurisdiction?: string;
  zone?: string;
  relatedHazards: string[];
  incidentProfileId?: string;
  recommendedTeam?: string;
  dispatchPriority?: "low" | "medium" | "high" | "critical";
  responseSlaMinutes?: number;
  firstResponseDueAt?: string;
  escalationPath?: string[];
  playbookSteps?: string[];
  detectedAt: string;
  createdAt: string;
  updatedAt: string;
  recordedAt: string;
  seq: number;
  prevHash: string;
}

export interface MiceEvidence {
  id: string;
  issueId: string;
  actionId?: string;
  evidenceType: "photo" | "video" | "document" | "note";
  localPath?: string;
  fileSha256?: string | null;
  fileBytes?: number | null;
  description: string;
  capturedAt: string;
  createdAt: string;
  recordedAt: string;
  seq: number;
  prevHash: string;
}

export interface MiceAction {
  id: string;
  issueId: string;
  title: string;
  assignee: string;
  team?: string;
  priority: "low" | "medium" | "high" | "critical";
  status: ActionStatus;
  dueAt?: string;
  assignedAt: string;
  completedAt?: string;
  completionNote?: string;
  evidenceIds: string[];
}

export interface MiceCommandDecision {
  id: string;
  eventName: string;
  decisionType: CommandDecisionType;
  status: CommandDecisionStatus;
  level: "advisory" | "partial" | "full";
  reason: string;
  decidedBy: string;
  issueId?: string;
  zone?: string;
  effectiveAt: string;
  notifyTargets: string[];
  conditionsForResume: string[];
  releasedAt?: string;
  releasedByDecisionId?: string;
  releaseReason?: string;
  conditionsMet?: string[];
  supersededAt?: string;
  supersededByDecisionId?: string;
  createdAt: string;
  recordedAt: string;
  seq: number;
  prevHash: string;
}

export interface MiceRunsheetItem {
  id: string;
  eventName: string;
  stage: string;
  checkpoint: string;
  recommendedDate: string;
  target: string;
  task: string;
  owner: string;
  evidenceRequired: string;
  escalation: string;
  status: RunsheetStatus;
  source?: string;
  linkedIssueId?: string;
  actionId?: string;
  note?: string;
  evidenceIds: string[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  updatedBy?: string;
}

export interface MiceOperationsState {
  version: string;
  seqCounter: number;
  lastHash: string;
  issues: MiceIssue[];
  evidences: MiceEvidence[];
  actions: MiceAction[];
  commandDecisions: MiceCommandDecision[];
  runsheetItems: MiceRunsheetItem[];
}

export interface StoreSnapshot {
  dir: string;
  state: MiceOperationsState;
}

function storeDir(): string {
  return process.env.MICE_LOCAL_DIR ?? join(homedir(), ".korea-mice-safety-agent");
}

function storePath(): string {
  return join(storeDir(), "operations.json");
}

function backupPath(): string {
  return join(storeDir(), "operations.json.bak");
}

function journalPath(): string {
  return join(storeDir(), "operations-journal.jsonl");
}

function nowIso(): string {
  return new Date().toISOString();
}

function createId(prefix: string): string {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "");
  return `${prefix}_${stamp}_${randomUUID()}`;
}

function canonicalJson(record: unknown): string {
  return JSON.stringify(record, Object.keys(record as Record<string, unknown>).sort());
}

function hashRecord(record: unknown): string {
  return createHash("sha256").update(canonicalJson(record)).digest("hex");
}

// Stamps non-overridable server recordedAt + monotonic seq + hash-chain prevHash on a new
// record, appends it to the append-only journal, and advances the chain. The record object is
// mutated in place so callers keep a reference to the stamped version.
function sealRecord<T extends { recordedAt?: string; seq?: number; prevHash?: string }>(
  state: MiceOperationsState,
  kind: string,
  record: T,
): T {
  state.seqCounter = (state.seqCounter ?? 0) + 1;
  record.recordedAt = nowIso();
  record.seq = state.seqCounter;
  record.prevHash = state.lastHash ?? "";
  const recordHash = hashRecord(record);
  state.lastHash = recordHash;
  appendFileSync(journalPath(), `${JSON.stringify({ kind, recordHash, record })}\n`);
  return record;
}

// Appends a non-record audit event (e.g. illegal transition) to the journal without disturbing
// the snapshot's hash chain.
function journalAnomaly(detail: Record<string, unknown>): void {
  mkdirSync(storeDir(), { recursive: true });
  appendFileSync(journalPath(), `${JSON.stringify({ kind: "anomaly", at: nowIso(), ...detail })}\n`);
}

function initialState(): MiceOperationsState {
  return {
    version: VERSION,
    seqCounter: 0,
    lastHash: "",
    issues: [],
    evidences: [],
    actions: [],
    commandDecisions: [],
    runsheetItems: [],
  };
}

function isActiveCommandDecisionType(decisionType: CommandDecisionType): boolean {
  return ["evacuation_start", "shelter_in_place", "event_pause", "event_stop"].includes(decisionType);
}

function isReleaseCommandDecisionType(decisionType: CommandDecisionType): boolean {
  return ["event_resume", "all_clear"].includes(decisionType);
}

function commandScopeKey(decision: Pick<MiceCommandDecision, "eventName" | "zone">): string {
  return `${decision.eventName}|${decision.zone ?? "*"}`;
}

function decisionOrderValue(decision: Pick<MiceCommandDecision, "recordedAt" | "effectiveAt" | "createdAt" | "id">): string {
  // recordedAt is the non-overridable server timestamp and is the authoritative audit/ordering key
  // (caller-supplied effectiveAt is declared-but-untrusted and could be backdated).
  return `${decision.recordedAt ?? ""}|${decision.effectiveAt}|${decision.createdAt}|${decision.id}`;
}

function recomputeLegacyCommandLifecycle(decisions: MiceCommandDecision[]): MiceCommandDecision[] {
  const ordered = [...decisions].sort((a, b) => decisionOrderValue(a).localeCompare(decisionOrderValue(b)));
  const activeByScope = new Map<string, MiceCommandDecision>();

  for (const decision of ordered) {
    decision.status = isActiveCommandDecisionType(decision.decisionType) ? "active" : "informational";
    decision.releasedAt = undefined;
    decision.releasedByDecisionId = undefined;
    decision.releaseReason = undefined;
    decision.conditionsMet = undefined;
    decision.supersededAt = undefined;
    decision.supersededByDecisionId = undefined;

    const scopeKey = commandScopeKey(decision);
    if (isActiveCommandDecisionType(decision.decisionType)) {
      const previous = activeByScope.get(scopeKey);
      if (previous) {
        previous.status = "superseded";
        previous.supersededAt = decision.effectiveAt;
        previous.supersededByDecisionId = decision.id;
      }
      activeByScope.set(scopeKey, decision);
      continue;
    }

    if (isReleaseCommandDecisionType(decision.decisionType)) {
      const previous = activeByScope.get(scopeKey);
      if (previous) {
        previous.status = "released";
        previous.releasedAt = decision.effectiveAt;
        previous.releasedByDecisionId = decision.id;
        previous.releaseReason = decision.reason;
        previous.conditionsMet = decision.conditionsForResume;
        activeByScope.delete(scopeKey);
      }
    }
  }

  return decisions;
}

function migrateState(state: MiceOperationsState): MiceOperationsState {
  const commandDecisions = (state.commandDecisions ?? []) as MiceCommandDecision[];
  const hasLegacyDecision = commandDecisions.some((decision) => !decision.status);
  return {
    ...state,
    seqCounter: state.seqCounter ?? 0,
    lastHash: state.lastHash ?? "",
    issues: state.issues ?? [],
    evidences: state.evidences ?? [],
    actions: state.actions ?? [],
    commandDecisions: hasLegacyDecision ? recomputeLegacyCommandLifecycle(commandDecisions) : commandDecisions,
    runsheetItems: state.runsheetItems ?? [],
  };
}

function parseStore(path: string): MiceOperationsState {
  return JSON.parse(readFileSync(path, "utf8")) as MiceOperationsState;
}

export function readStore(): StoreSnapshot {
  const dir = storeDir();
  const path = storePath();
  mkdirSync(dir, { recursive: true });
  if (!existsSync(path)) {
    const state = initialState();
    writeStore(state);
    return { dir, state };
  }
  try {
    return { dir, state: migrateState(parseStore(path)) };
  } catch {
    // Primary snapshot is corrupt (e.g. partial write before atomic rename landed).
    // Fall back to the rolling backup so the audit trail survives.
    if (existsSync(backupPath())) {
      return { dir, state: migrateState(parseStore(backupPath())) };
    }
    throw new Error(`operations.json is corrupt and no usable ${backupPath()} backup exists`);
  }
}

export function writeStore(state: MiceOperationsState): StoreSnapshot {
  const dir = storeDir();
  const path = storePath();
  mkdirSync(dir, { recursive: true });
  const serialized = `${JSON.stringify(state, null, 2)}\n`;
  // Roll the current good snapshot into the backup before we overwrite it.
  if (existsSync(path)) {
    copyFileSync(path, backupPath());
  }
  // Write to a temp file in the SAME directory, fsync, then atomically rename over the target
  // (rename is atomic on POSIX, so a crash mid-write never leaves a half-written operations.json).
  const tmpPath = join(dir, `operations.json.tmp-${process.pid}-${Date.now()}`);
  const fd = openSync(tmpPath, "w");
  try {
    writeFileSync(fd, serialized);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmpPath, path);
  return { dir, state };
}

export function registerIssue(input: Omit<MiceIssue, "id" | "status" | "createdAt" | "updatedAt" | "recordedAt" | "seq" | "prevHash"> & { status?: IssueStatus }): StoreSnapshot & { issue: MiceIssue } {
  const snapshot = readStore();
  const timestamp = nowIso();
  const issue: MiceIssue = {
    ...input,
    id: createId("issue"),
    status: input.status ?? "open",
    createdAt: timestamp,
    updatedAt: timestamp,
    recordedAt: "",
    seq: 0,
    prevHash: "",
  };
  sealRecord(snapshot.state, "issue", issue);
  snapshot.state.issues.push(issue);
  const saved = writeStore(snapshot.state);
  return { ...saved, issue };
}

export function recordEvidence(input: Omit<MiceEvidence, "id" | "createdAt" | "recordedAt" | "seq" | "prevHash">): StoreSnapshot & { evidence: MiceEvidence } {
  const snapshot = readStore();
  if (!snapshot.state.issues.some((issue) => issue.id === input.issueId)) {
    throw new Error(`Unknown issueId: ${input.issueId}`);
  }
  const evidence: MiceEvidence = {
    ...input,
    id: createId("evidence"),
    createdAt: nowIso(),
    recordedAt: "",
    seq: 0,
    prevHash: "",
  };
  sealRecord(snapshot.state, "evidence", evidence);
  snapshot.state.evidences.push(evidence);
  const saved = writeStore(snapshot.state);
  return { ...saved, evidence };
}

export function assignAction(input: Omit<MiceAction, "id" | "status" | "assignedAt" | "evidenceIds" | "priority"> & {
  priority?: MiceAction["priority"];
  status?: ActionStatus;
  evidenceIds?: string[];
}): StoreSnapshot & { action: MiceAction } {
  const snapshot = readStore();
  const issue = snapshot.state.issues.find((item) => item.id === input.issueId);
  if (!issue) throw new Error(`Unknown issueId: ${input.issueId}`);
  const action: MiceAction = {
    ...input,
    id: createId("action"),
    team: input.team ?? issue.recommendedTeam,
    priority: input.priority ?? issue.dispatchPriority ?? issue.severity,
    status: input.status ?? "assigned",
    dueAt: input.dueAt ?? issue.firstResponseDueAt,
    assignedAt: nowIso(),
    evidenceIds: input.evidenceIds ?? [],
  };
  snapshot.state.actions.push(action);
  issue.status = issue.status === "open" ? "assigned" : issue.status;
  issue.updatedAt = nowIso();
  const saved = writeStore(snapshot.state);
  return { ...saved, action };
}

export function completeAction(input: {
  actionId: string;
  completedBy?: string;
  completionNote: string;
  evidenceIds?: string[];
  closeIssue?: boolean;
}): StoreSnapshot & { action: MiceAction; issue: MiceIssue } {
  const snapshot = readStore();
  const action = snapshot.state.actions.find((item) => item.id === input.actionId);
  if (!action) throw new Error(`Unknown actionId: ${input.actionId}`);
  const issue = snapshot.state.issues.find((item) => item.id === action.issueId);
  if (!issue) throw new Error(`Unknown issueId: ${action.issueId}`);
  // Reject double-complete / completing a cancelled action so the original completion record is
  // never silently overwritten; log the illegal transition to the append-only journal.
  if (action.status === "completed" || action.status === "cancelled") {
    journalAnomaly({
      kind: "anomaly",
      anomaly: "illegal_action_transition",
      actionId: action.id,
      issueId: issue.id,
      from: action.status,
      to: "completed",
      attemptedBy: input.completedBy,
    });
    throw new Error(`Action ${action.id} is already ${action.status}; cannot complete again`);
  }
  action.status = "completed";
  action.completedAt = nowIso();
  action.completionNote = input.completedBy ? `${input.completionNote} (완료자: ${input.completedBy})` : input.completionNote;
  action.evidenceIds = Array.from(new Set([...action.evidenceIds, ...(input.evidenceIds ?? [])]));
  issue.status = input.closeIssue === false ? "in_progress" : "resolved";
  issue.updatedAt = nowIso();
  const saved = writeStore(snapshot.state);
  return { ...saved, action, issue };
}

function applyNewCommandLifecycle(state: MiceOperationsState, commandDecision: MiceCommandDecision): void {
  const scopeKey = commandScopeKey(commandDecision);

  if (isActiveCommandDecisionType(commandDecision.decisionType)) {
    commandDecision.status = "active";
    for (const previous of state.commandDecisions) {
      if (previous.id === commandDecision.id) continue;
      if (previous.status !== "active") continue;
      if (commandScopeKey(previous) !== scopeKey) continue;
      previous.status = "superseded";
      previous.supersededAt = commandDecision.effectiveAt;
      previous.supersededByDecisionId = commandDecision.id;
    }
    return;
  }

  commandDecision.status = "informational";
  if (!isReleaseCommandDecisionType(commandDecision.decisionType)) return;

  for (const previous of state.commandDecisions) {
    if (previous.id === commandDecision.id) continue;
    if (previous.status !== "active") continue;
    if (commandScopeKey(previous) !== scopeKey) continue;
    previous.status = "released";
    previous.releasedAt = commandDecision.effectiveAt;
    previous.releasedByDecisionId = commandDecision.id;
    previous.releaseReason = commandDecision.reason;
    previous.conditionsMet = commandDecision.conditionsForResume;
  }
}

export function recordCommandDecision(input: Omit<MiceCommandDecision, "id" | "createdAt" | "status" | "recordedAt" | "seq" | "prevHash">): StoreSnapshot & { commandDecision: MiceCommandDecision } {
  const snapshot = readStore();
  if (input.issueId && !snapshot.state.issues.some((issue) => issue.id === input.issueId)) {
    throw new Error(`Unknown issueId: ${input.issueId}`);
  }
  const commandDecision: MiceCommandDecision = {
    ...input,
    id: createId("command"),
    status: "informational",
    createdAt: nowIso(),
    recordedAt: "",
    seq: 0,
    prevHash: "",
  };
  snapshot.state.commandDecisions.push(commandDecision);
  applyNewCommandLifecycle(snapshot.state, commandDecision);
  sealRecord(snapshot.state, "command_decision", commandDecision);
  const saved = writeStore(snapshot.state);
  return { ...saved, commandDecision };
}

export function resolveCommandDecision(input: {
  commandDecisionId?: string;
  eventName?: string;
  zone?: string;
  resolutionType: Extract<CommandDecisionType, "event_resume" | "all_clear">;
  reason: string;
  decidedBy: string;
  effectiveAt?: string;
  notifyTargets?: string[];
  conditionsMet?: string[];
}): StoreSnapshot & { targetDecision: MiceCommandDecision; resolutionDecision: MiceCommandDecision } {
  const snapshot = readStore();
  const candidates = snapshot.state.commandDecisions
    .filter((decision) => decision.status === "active")
    .filter((decision) => {
      if (input.commandDecisionId) return decision.id === input.commandDecisionId;
      if (input.eventName && decision.eventName !== input.eventName) return false;
      if (input.zone !== undefined && decision.zone !== input.zone) return false;
      return Boolean(input.eventName);
    })
    .sort((a, b) => decisionOrderValue(b).localeCompare(decisionOrderValue(a)));

  const targetDecision = candidates[0];
  if (!targetDecision) {
    throw new Error(input.commandDecisionId
      ? `No active command decision found for id: ${input.commandDecisionId}`
      : "No active command decision found for the requested event/zone");
  }
  // Validate the resolution is a release-type decision applied to a still-active target.
  if (!isReleaseCommandDecisionType(input.resolutionType)) {
    journalAnomaly({
      anomaly: "illegal_command_resolution",
      targetDecisionId: targetDecision.id,
      from: targetDecision.status,
      resolutionType: input.resolutionType,
      decidedBy: input.decidedBy,
    });
    throw new Error(`resolutionType ${input.resolutionType} is not a valid release/all_clear resolution`);
  }
  if (targetDecision.status !== "active") {
    journalAnomaly({
      anomaly: "illegal_command_resolution",
      targetDecisionId: targetDecision.id,
      from: targetDecision.status,
      resolutionType: input.resolutionType,
      decidedBy: input.decidedBy,
    });
    throw new Error(`Command decision ${targetDecision.id} is ${targetDecision.status}; only active decisions can be resolved`);
  }

  const effectiveAt = input.effectiveAt ?? nowIso();
  const resolutionDecision: MiceCommandDecision = {
    id: createId("command"),
    eventName: targetDecision.eventName,
    decisionType: input.resolutionType,
    status: "informational",
    level: targetDecision.level,
    reason: input.reason,
    decidedBy: input.decidedBy,
    issueId: targetDecision.issueId,
    zone: targetDecision.zone,
    effectiveAt,
    notifyTargets: input.notifyTargets ?? targetDecision.notifyTargets,
    conditionsForResume: input.conditionsMet ?? [],
    createdAt: nowIso(),
    recordedAt: "",
    seq: 0,
    prevHash: "",
  };

  snapshot.state.commandDecisions.push(resolutionDecision);
  targetDecision.status = "released";
  targetDecision.releasedAt = effectiveAt;
  targetDecision.releasedByDecisionId = resolutionDecision.id;
  targetDecision.releaseReason = input.reason;
  targetDecision.conditionsMet = input.conditionsMet ?? [];
  sealRecord(snapshot.state, "command_decision", resolutionDecision);

  const saved = writeStore(snapshot.state);
  return { ...saved, targetDecision, resolutionDecision };
}

function runsheetKey(item: Pick<MiceRunsheetItem, "eventName" | "stage" | "checkpoint" | "target" | "task">): string {
  return [item.eventName, item.stage, item.checkpoint, item.target, item.task]
    .map((value) => value.replace(/\s+/g, " ").trim())
    .join("|");
}

export function upsertRunsheetItems(input: {
  eventName: string;
  source?: string;
  items: Array<Omit<MiceRunsheetItem, "id" | "eventName" | "status" | "createdAt" | "updatedAt" | "evidenceIds"> & {
    status?: RunsheetStatus;
    evidenceIds?: string[];
  }>;
}): StoreSnapshot & { items: MiceRunsheetItem[]; createdCount: number; updatedCount: number } {
  const snapshot = readStore();
  const timestamp = nowIso();
  let createdCount = 0;
  let updatedCount = 0;
  const savedItems: MiceRunsheetItem[] = [];

  for (const item of input.items) {
    const candidate = {
      eventName: input.eventName,
      stage: item.stage,
      checkpoint: item.checkpoint,
      target: item.target,
      task: item.task,
    };
    const key = runsheetKey(candidate);
    const existing = snapshot.state.runsheetItems.find((runsheetItem) => runsheetKey(runsheetItem) === key);
    if (existing) {
      existing.recommendedDate = item.recommendedDate;
      existing.owner = item.owner;
      existing.evidenceRequired = item.evidenceRequired;
      existing.escalation = item.escalation;
      existing.source = input.source ?? item.source ?? existing.source;
      existing.updatedAt = timestamp;
      updatedCount += 1;
      savedItems.push(existing);
      continue;
    }

    const runsheetItem: MiceRunsheetItem = {
      ...item,
      id: createId("runsheet"),
      eventName: input.eventName,
      status: item.status ?? "open",
      source: input.source ?? item.source,
      evidenceIds: item.evidenceIds ?? [],
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    snapshot.state.runsheetItems.push(runsheetItem);
    createdCount += 1;
    savedItems.push(runsheetItem);
  }

  const saved = writeStore(snapshot.state);
  return { ...saved, items: savedItems, createdCount, updatedCount };
}

export function updateRunsheetItem(input: {
  itemId: string;
  status: RunsheetStatus;
  note?: string;
  updatedBy?: string;
  linkedIssueId?: string;
  actionId?: string;
  evidenceIds?: string[];
}): StoreSnapshot & { item: MiceRunsheetItem } {
  const snapshot = readStore();
  const item = snapshot.state.runsheetItems.find((runsheetItem) => runsheetItem.id === input.itemId);
  if (!item) throw new Error(`Unknown runsheet itemId: ${input.itemId}`);
  if (input.linkedIssueId && !snapshot.state.issues.some((issue) => issue.id === input.linkedIssueId)) {
    throw new Error(`Unknown issueId: ${input.linkedIssueId}`);
  }
  if (input.actionId && !snapshot.state.actions.some((action) => action.id === input.actionId)) {
    throw new Error(`Unknown actionId: ${input.actionId}`);
  }
  // 'done' is terminal: reject transitions that would re-open it and discard the original
  // completedAt; log the illegal transition to the append-only journal.
  if (item.status === "done" && input.status !== "done") {
    journalAnomaly({
      anomaly: "illegal_runsheet_transition",
      itemId: item.id,
      eventName: item.eventName,
      from: item.status,
      to: input.status,
      attemptedBy: input.updatedBy,
    });
    throw new Error(`Runsheet item ${item.id} is done; cannot transition to ${input.status}`);
  }

  item.status = input.status;
  item.note = input.note ?? item.note;
  item.updatedBy = input.updatedBy ?? item.updatedBy;
  item.linkedIssueId = input.linkedIssueId ?? item.linkedIssueId;
  item.actionId = input.actionId ?? item.actionId;
  item.evidenceIds = Array.from(new Set([...item.evidenceIds, ...(input.evidenceIds ?? [])]));
  item.updatedAt = nowIso();
  item.completedAt = input.status === "done" ? item.updatedAt : item.completedAt;

  const saved = writeStore(snapshot.state);
  return { ...saved, item };
}

export function reportOperations(filters: { issueId?: string; eventName?: string; includeResolved?: boolean }): StoreSnapshot & {
  issues: MiceIssue[];
  actions: MiceAction[];
  evidences: MiceEvidence[];
  commandDecisions: MiceCommandDecision[];
  runsheetItems: MiceRunsheetItem[];
} {
  const snapshot = readStore();
  const issues = snapshot.state.issues.filter((issue) => {
    if (filters.issueId && issue.id !== filters.issueId) return false;
    if (filters.eventName && issue.eventName !== filters.eventName) return false;
    if (filters.includeResolved === false && ["resolved", "verified"].includes(issue.status)) return false;
    return true;
  });
  const issueIds = new Set(issues.map((issue) => issue.id));
  const actions = snapshot.state.actions.filter((action) => issueIds.has(action.issueId));
  const evidences = snapshot.state.evidences.filter((evidence) => issueIds.has(evidence.issueId));
  const commandDecisions = snapshot.state.commandDecisions.filter((decision) => {
    if (filters.issueId && decision.issueId !== filters.issueId) return false;
    if (filters.eventName && decision.eventName !== filters.eventName) return false;
    return true;
  });
  const runsheetItems = snapshot.state.runsheetItems.filter((item) => {
    if (filters.issueId && item.linkedIssueId !== filters.issueId) return false;
    if (filters.eventName && item.eventName !== filters.eventName) return false;
    return true;
  });
  return { ...snapshot, issues, actions, evidences, commandDecisions, runsheetItems };
}
