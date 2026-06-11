import { writeFileSync } from "node:fs";
import { deflateRawSync } from "node:zlib";

export type XlsxCell = string | number | boolean | Date | null | undefined;

export interface XlsxSheet {
  name: string;
  rows: XlsxCell[][];
}

const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n += 1) {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable[n] = c >>> 0;
}

function crc32(buffer: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(date: Date): { date: number; time: number } {
  const year = Math.max(date.getFullYear(), 1980);
  return {
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
  };
}

function uint16(value: number): Buffer {
  const out = Buffer.alloc(2);
  out.writeUInt16LE(value & 0xffff, 0);
  return out;
}

function uint32(value: number): Buffer {
  const out = Buffer.alloc(4);
  out.writeUInt32LE(value >>> 0, 0);
  return out;
}

function zip(files: Array<{ path: string; data: Buffer }>): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  const stamp = dosDateTime(new Date());

  for (const file of files) {
    const name = Buffer.from(file.path, "utf8");
    const compressed = deflateRawSync(file.data);
    const crc = crc32(file.data);
    const local = Buffer.concat([
      uint32(0x04034b50),
      uint16(20),
      uint16(0x0800),
      uint16(8),
      uint16(stamp.time),
      uint16(stamp.date),
      uint32(crc),
      uint32(compressed.length),
      uint32(file.data.length),
      uint16(name.length),
      uint16(0),
      name,
      compressed,
    ]);
    parts.push(local);

    central.push(Buffer.concat([
      uint32(0x02014b50),
      uint16(20),
      uint16(20),
      uint16(0x0800),
      uint16(8),
      uint16(stamp.time),
      uint16(stamp.date),
      uint32(crc),
      uint32(compressed.length),
      uint32(file.data.length),
      uint16(name.length),
      uint16(0),
      uint16(0),
      uint16(0),
      uint16(0),
      uint32(0),
      uint32(offset),
      name,
    ]));
    offset += local.length;
  }

  const centralDirectory = Buffer.concat(central);
  const end = Buffer.concat([
    uint32(0x06054b50),
    uint16(0),
    uint16(0),
    uint16(files.length),
    uint16(files.length),
    uint32(centralDirectory.length),
    uint32(offset),
    uint16(0),
  ]);
  return Buffer.concat([...parts, centralDirectory, end]);
}

function xml(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function columnName(index: number): string {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const mod = (n - 1) % 26;
    out = String.fromCharCode(65 + mod) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function sheetName(value: string, used: Set<string>): string {
  const base = (value || "Sheet")
    .replace(/[\[\]:*?/\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 31) || "Sheet";
  let candidate = base;
  let i = 2;
  while (used.has(candidate)) {
    const suffix = ` ${i}`;
    candidate = `${base.slice(0, 31 - suffix.length)}${suffix}`;
    i += 1;
  }
  used.add(candidate);
  return candidate;
}

function cellXml(cell: XlsxCell, rowIndex: number, columnIndex: number, header: boolean): string {
  const ref = `${columnName(columnIndex)}${rowIndex + 1}`;
  const style = header ? ' s="1"' : "";
  if (cell === null || cell === undefined) return `<c r="${ref}"${style}/>`;
  if (typeof cell === "number" && Number.isFinite(cell)) return `<c r="${ref}"${style}><v>${cell}</v></c>`;
  if (typeof cell === "boolean") return `<c r="${ref}" t="b"${style}><v>${cell ? 1 : 0}</v></c>`;
  const text = cell instanceof Date ? cell.toISOString() : String(cell);
  return `<c r="${ref}" t="inlineStr"${style}><is><t>${xml(text)}</t></is></c>`;
}

function worksheetXml(sheet: XlsxSheet): string {
  const rows = sheet.rows.length > 0 ? sheet.rows : [[]];
  const maxColumns = Math.max(1, ...rows.map((row) => row.length));
  const dimension = `A1:${columnName(maxColumns - 1)}${rows.length}`;
  const body = rows.map((row, rowIndex) => {
    const cells = row.map((cell, columnIndex) => cellXml(cell, rowIndex, columnIndex, rowIndex === 0)).join("");
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="${dimension}"/>
  <sheetViews><sheetView workbookViewId="0"/></sheetViews>
  <sheetFormatPr defaultRowHeight="15"/>
  <sheetData>${body}</sheetData>
</worksheet>`;
}

function workbookXml(sheets: Array<{ name: string; id: number }>): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>${sheets.map((sheet) => `<sheet name="${xml(sheet.name)}" sheetId="${sheet.id}" r:id="rId${sheet.id}"/>`).join("")}</sheets>
</workbook>`;
}

function workbookRelsXml(count: number): string {
  const worksheetRels = Array.from({ length: count }, (_, index) => {
    const id = index + 1;
    return `<Relationship Id="rId${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${id}.xml"/>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${worksheetRels}
  <Relationship Id="rId${count + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;
}

function contentTypesXml(count: number): string {
  const sheets = Array.from({ length: count }, (_, index) => (
    `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
  )).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
  ${sheets}
</Types>`;
}

const rootRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;

const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
  <fills count="1"><fill><patternFill patternType="none"/></fill></fills>
  <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>
</styleSheet>`;

function coreXml(createdAt: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:creator>korea-mice-safety-agent</dc:creator>
  <cp:lastModifiedBy>korea-mice-safety-agent</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">${createdAt}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${createdAt}</dcterms:modified>
</cp:coreProperties>`;
}

function appXml(sheetNames: string[]): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>korea-mice-safety-agent</Application>
  <HeadingPairs><vt:vector size="2" baseType="variant"><vt:variant><vt:lpstr>Worksheets</vt:lpstr></vt:variant><vt:variant><vt:i4>${sheetNames.length}</vt:i4></vt:variant></vt:vector></HeadingPairs>
  <TitlesOfParts><vt:vector size="${sheetNames.length}" baseType="lpstr">${sheetNames.map((name) => `<vt:lpstr>${xml(name)}</vt:lpstr>`).join("")}</vt:vector></TitlesOfParts>
</Properties>`;
}

export function objectRows(headers: string[], rows: Array<Record<string, XlsxCell>>): XlsxCell[][] {
  return [
    headers,
    ...rows.map((row) => headers.map((header) => row[header] ?? "")),
  ];
}

export function writeXlsxFile(filePath: string, inputSheets: XlsxSheet[]): void {
  const used = new Set<string>();
  const sheets = inputSheets
    .filter((sheet) => sheet.rows.length > 0)
    .map((sheet, index) => ({
      id: index + 1,
      name: sheetName(sheet.name, used),
      rows: sheet.rows,
    }));
  if (sheets.length === 0) sheets.push({ id: 1, name: "Sheet1", rows: [["No data"]] });

  const createdAt = new Date().toISOString();
  const files: Array<{ path: string; data: Buffer }> = [
    { path: "[Content_Types].xml", data: Buffer.from(contentTypesXml(sheets.length)) },
    { path: "_rels/.rels", data: Buffer.from(rootRelsXml) },
    { path: "docProps/core.xml", data: Buffer.from(coreXml(createdAt)) },
    { path: "docProps/app.xml", data: Buffer.from(appXml(sheets.map((sheet) => sheet.name))) },
    { path: "xl/workbook.xml", data: Buffer.from(workbookXml(sheets)) },
    { path: "xl/_rels/workbook.xml.rels", data: Buffer.from(workbookRelsXml(sheets.length)) },
    { path: "xl/styles.xml", data: Buffer.from(stylesXml) },
    ...sheets.map((sheet) => ({
      path: `xl/worksheets/sheet${sheet.id}.xml`,
      data: Buffer.from(worksheetXml(sheet)),
    })),
  ];

  writeFileSync(filePath, zip(files), { flag: "wx" });
}
