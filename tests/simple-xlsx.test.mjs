import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32, inflateRawSync } from "node:zlib";

import { writeXlsxFile } from "../build/lib/simple-xlsx.js";

// simple-xlsx.ts hand-writes the OOXML package and the ZIP container byte by byte, so a wrong
// offset or length produces a file that still "writes fine" but no spreadsheet app can open.
// These tests walk the container the way a reader would instead of trusting the writer.

const workDir = mkdtempSync(join(tmpdir(), "mice-xlsx-"));

after(() => {
  rmSync(workDir, { recursive: true, force: true });
});

const expectedParts = [
  "[Content_Types].xml",
  "_rels/.rels",
  "docProps/core.xml",
  "docProps/app.xml",
  "xl/workbook.xml",
  "xl/_rels/workbook.xml.rels",
  "xl/styles.xml",
  "xl/worksheets/sheet1.xml",
];

function writeBook(fileName, sheets) {
  const filePath = join(workDir, fileName);
  writeXlsxFile(filePath, sheets);
  return readFileSync(filePath);
}

// Reads the end-of-central-directory record and walks the central directory, the same path a
// real unzip takes. Any drift between the recorded sizes/offsets and the actual bytes fails here.
function readCentralDirectory(buffer) {
  const eocd = buffer.length - 22;
  assert.equal(buffer.readUInt32LE(eocd), 0x06054b50, "end-of-central-directory signature missing");
  const entryCount = buffer.readUInt16LE(eocd + 10);
  const centralSize = buffer.readUInt32LE(eocd + 12);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  assert.equal(buffer.readUInt16LE(eocd + 8), entryCount, "disk entry count disagrees with total");
  assert.equal(centralOffset + centralSize, eocd, "central directory does not end where the EOCD starts");

  const entries = [];
  let cursor = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    assert.equal(buffer.readUInt32LE(cursor), 0x02014b50, `central header ${index} signature missing`);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    entries.push({
      crc: buffer.readUInt32LE(cursor + 16),
      compressedSize: buffer.readUInt32LE(cursor + 20),
      uncompressedSize: buffer.readUInt32LE(cursor + 24),
      localOffset: buffer.readUInt32LE(cursor + 42),
      path: buffer.toString("utf8", cursor + 46, cursor + 46 + nameLength),
    });
    cursor += 46 + nameLength + buffer.readUInt16LE(cursor + 30) + buffer.readUInt16LE(cursor + 32);
  }
  assert.equal(cursor, centralOffset + centralSize, "central directory entries overrun their declared size");
  return entries;
}

function readPart(buffer, entry) {
  assert.equal(buffer.readUInt32LE(entry.localOffset), 0x04034b50, `local header signature missing for ${entry.path}`);
  const nameLength = buffer.readUInt16LE(entry.localOffset + 26);
  const extraLength = buffer.readUInt16LE(entry.localOffset + 28);
  const nameStart = entry.localOffset + 30;
  assert.equal(buffer.toString("utf8", nameStart, nameStart + nameLength), entry.path, "local header points at a different part");
  assert.equal(buffer.readUInt32LE(entry.localOffset + 18), entry.compressedSize, `compressed size mismatch for ${entry.path}`);
  assert.equal(buffer.readUInt32LE(entry.localOffset + 22), entry.uncompressedSize, `uncompressed size mismatch for ${entry.path}`);

  const dataStart = nameStart + nameLength + extraLength;
  const inflated = inflateRawSync(buffer.subarray(dataStart, dataStart + entry.compressedSize));
  assert.equal(inflated.length, entry.uncompressedSize, `inflated length mismatch for ${entry.path}`);
  assert.equal(crc32(inflated) >>> 0, entry.crc, `crc32 mismatch for ${entry.path}`);
  return inflated.toString("utf8");
}

function readBookParts(buffer) {
  const entries = readCentralDirectory(buffer);
  return new Map(entries.map((entry) => [entry.path, readPart(buffer, entry)]));
}

test("a single-sheet workbook contains exactly the 8 OOXML parts", () => {
  const buffer = writeBook("parts.xlsx", [{ name: "점검", rows: [["항목"], ["대피동선"]] }]);
  assert.equal(buffer.subarray(0, 2).toString("latin1"), "PK");
  const paths = readCentralDirectory(buffer).map((entry) => entry.path);
  assert.deepEqual(paths, expectedParts);
});

test("every central directory offset resolves to a matching local header and payload", () => {
  const buffer = writeBook("offsets.xlsx", [
    { name: "체크리스트", rows: [["항목", "담당"], ["소화기 점검", "시설팀"]] },
    { name: "런시트", rows: [["시각", "작업"], ["09:00", "개장 전 점검"]] },
  ]);
  const parts = readBookParts(buffer);
  assert.equal(parts.size, 9, "two sheets should add a second worksheet part");
  assert.equal(parts.has("xl/worksheets/sheet2.xml"), true);
  assert.equal(parts.get("xl/workbook.xml").includes('sheetId="2"'), true);
});

test("sheet XML escapes XML metacharacters and keeps Korean text intact", () => {
  const buffer = writeBook("escaping.xlsx", [{
    name: "안전 점검",
    rows: [
      ["항목", "비고"],
      ["대피동선 <A게이트> 확보", '주최 & 베뉴 "공동" 확인'],
      ["운영본부's 승인", "밀집도 > 4명/㎡"],
    ],
  }]);
  const sheet = readBookParts(buffer).get("xl/worksheets/sheet1.xml");

  assert.equal(sheet.includes("대피동선 &lt;A게이트&gt; 확보"), true);
  assert.equal(sheet.includes("주최 &amp; 베뉴 &quot;공동&quot; 확인"), true);
  assert.equal(sheet.includes("운영본부&apos;s 승인"), true);
  assert.equal(sheet.includes("밀집도 &gt; 4명/㎡"), true);
  assert.equal(sheet.includes("<A게이트>"), false, "raw angle brackets would break the worksheet XML");
  assert.equal(sheet.includes("& 베뉴"), false, "a bare ampersand would break the worksheet XML");
  // Header row keeps the bold style and the dimension covers both columns of the widest row.
  assert.equal(sheet.includes('<c r="A1" t="inlineStr" s="1">'), true);
  assert.equal(sheet.includes('<dimension ref="A1:B3"/>'), true);
});

test("row counts past the argument-spread limit do not overflow the stack", () => {
  // Math.max(1, ...rows.map(...)) threw RangeError from ~120k rows; the column scan is a loop now.
  const rows = Array.from({ length: 130_000 }, (_, index) => [`행 ${index}`]);
  const buffer = writeBook("wide.xlsx", [{ name: "대량", rows }]);
  const sheet = readBookParts(buffer).get("xl/worksheets/sheet1.xml");
  assert.equal(sheet.includes('<dimension ref="A1:A130000"/>'), true);
  assert.equal(sheet.includes('<row r="130000">'), true);
});
