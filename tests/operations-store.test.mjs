import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Reading the store creates operations.json under MICE_LOCAL_DIR, so the isolation has to be in
// place before the module is loaded at all — hence the dynamic import below.
const storeDir = mkdtempSync(join(tmpdir(), "mice-store-"));
process.env.MICE_LOCAL_DIR = storeDir;

const { readStore, registerIssue } = await import("../build/lib/mice-operations-store.js");

after(() => {
  rmSync(storeDir, { recursive: true, force: true });
});

const storePath = join(storeDir, "operations.json");
const journalPath = join(storeDir, "operations-journal.jsonl");

// Mirrors sealRecord's canonicalization: keys sorted so the digest does not depend on key order.
function hashRecord(record) {
  return createHash("sha256").update(JSON.stringify(record, Object.keys(record).sort())).digest("hex");
}

function readJournal() {
  return readFileSync(journalPath, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function issueInput(description) {
  return {
    eventName: "고양 야외 푸드 페스티벌",
    issueType: "crowd_bottleneck",
    severity: "high",
    description,
    relatedHazards: ["ingress_egress_bottleneck"],
    detectedAt: "2026-06-20T10:00:00.000Z",
  };
}

const registered = [
  registerIssue(issueInput("A게이트 대기열이 보행동선을 침범함")).issue,
  registerIssue(issueInput("B게이트 진입 통제 인력 부족")).issue,
  registerIssue(issueInput("C구역 피난통로에 적재물 방치")).issue,
];

test("sealed records carry a monotonic seq starting at 1", () => {
  assert.deepEqual(registered.map((issue) => issue.seq), [1, 2, 3]);
  assert.equal(registered.every((issue) => issue.recordedAt !== ""), true, "recordedAt must be stamped by the server");
  assert.equal(readStore().state.seqCounter, 3);
});

test("each record's prevHash is the digest of the record before it", () => {
  const entries = readJournal();
  assert.equal(entries.length, 3);
  assert.equal(entries[0].record.prevHash, "", "the first record opens the chain with an empty prevHash");
  for (let index = 1; index < entries.length; index += 1) {
    assert.equal(
      entries[index].record.prevHash,
      entries[index - 1].recordHash,
      `record ${index} does not chain to its predecessor`,
    );
  }
});

test("journalled digests match a recomputation of the stored records", () => {
  for (const entry of readJournal()) {
    assert.equal(hashRecord(entry.record), entry.recordHash, `recomputed digest differs for ${entry.record.id}`);
  }
});

test("the snapshot's lastHash is the digest of the newest record", () => {
  const entries = readJournal();
  assert.equal(readStore().state.lastHash, entries[entries.length - 1].recordHash);
});

test("editing a stored record makes its digest disagree with the journalled one", () => {
  const state = JSON.parse(readFileSync(storePath, "utf8"));
  const target = state.issues[1];
  const journalled = readJournal().find((entry) => entry.record.id === target.id);
  assert.equal(hashRecord(target), journalled.recordHash, "the untouched record should still verify");

  target.severity = "low";
  writeFileSync(storePath, `${JSON.stringify(state, null, 2)}\n`);

  const tampered = JSON.parse(readFileSync(storePath, "utf8")).issues[1];
  assert.equal(tampered.severity, "low");
  assert.notEqual(hashRecord(tampered), journalled.recordHash, "a severity downgrade must break the digest");
  // The chain is anchored on the original digest, so the next record no longer descends from it.
  assert.notEqual(readStore().state.issues[2].prevHash, hashRecord(tampered));
});
