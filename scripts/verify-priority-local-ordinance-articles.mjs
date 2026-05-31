#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const packPath = join(root, "src/ontology/mice/local-ordinance-pack.json");
const lawBase = "https://www.law.go.kr/LSW";
const today = new Date().toISOString().slice(0, 10);

const priorityJurisdictions = new Set([
  "서울특별시",
  "서울특별시 강남구",
  "서울특별시 서초구",
  "경기도",
  "경기도 고양시",
  "경기도 수원시",
  "부산광역시",
  "인천광역시",
  "인천광역시 연수구",
  "대구광역시",
  "광주광역시",
  "광주광역시 서구",
  "대전광역시",
  "대전광역시 유성구",
  "울산광역시",
  "경상북도",
  "경상북도 경주시",
  "경상북도 구미시",
  "경상북도 포항시",
  "경상남도",
  "경상남도 창원시",
  "전북특별자치도",
  "전북특별자치도 군산시",
  "전라남도",
  "전라남도 여수시",
  "제주특별자치도",
]);

const categoryKeywords = {
  outdoor_event_safety: /목적|정의|적용|안전관리계획|안전점검|긴급|안전관리요원|지원요청|관계기관|보험|배상|응급|중단|시정|보완/,
  regional_festival_safety: /목적|정의|적용|안전관리계획|지역축제|위원회|심의|보완|관계기관|합동|보험|배상/,
  road_occupancy: /목적|정의|도로점용|점용허가|점용료|교통소통|교통|공사|원상회복|허가|신고|감면|안전|보행/,
  outdoor_advertising: /목적|정의|광고물|옥외광고|현수막|허가|신고|표시방법|금지|안전점검|전기|풍압|제거|원상회복/,
};

function decodeHtml(value) {
  return String(value ?? "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
}

function cleanText(value) {
  return decodeHtml(value)
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

function stripHtml(html) {
  return cleanText(String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/p>|<\/div>|<\/li>|<\/tr>|<\/h\d>/gi, "\n")
    .replace(/<[^>]+>/g, " "));
}

function hiddenValue(html, id) {
  return html.match(new RegExp(`id=["']${id}["'][^>]*value=["']([^"']*)`))?.[1] ?? "";
}

async function fetchText(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "user-agent": "korea-mice-safety-agent offline ordinance verifier",
      ...(options.headers ?? {}),
    },
  });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.text();
}

async function fetchOrdinanceBody(record) {
  const ordinSeq = String(record.ordinSeq);
  const pageUrl = `${lawBase}/ordinInfoP.do?ordinSeq=${ordinSeq}`;
  const pageHtml = await fetchText(pageUrl);
  const gubun = hiddenValue(pageHtml, "gubun") || "ELIS";
  const params = new URLSearchParams({
    ordinSeq,
    chrClsCd: "010202",
    gubun,
    vSct: "",
    popOrdinSeq: ordinSeq,
  });
  const bodyHtml = await fetchText(`${lawBase}/ordinInfoR.do`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      "referer": pageUrl,
      "x-requested-with": "XMLHttpRequest",
    },
    body: params,
  });
  return {
    sourceUrl: pageUrl,
    title: hiddenValue(bodyHtml, "ordinNm") || record.name,
    effectiveAt: bodyHtml.match(/\[시행\s*([\d. ]+)\]/)?.[1]?.replace(/\s+/g, "").replace(/\.$/, "") ?? record.effectiveAt,
    text: stripHtml(bodyHtml),
  };
}

function splitArticles(text) {
  const re = /제\d+조(?:의\d+)?\s*(?:\([^)]+\))?/g;
  const matches = [...text.matchAll(re)]
    .filter((match) => match.index !== undefined)
    .map((match) => ({ index: match.index, title: cleanText(match[0]) }));
  const articles = [];
  for (let i = 0; i < matches.length; i += 1) {
    const start = matches[i].index;
    const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
    const block = cleanText(text.slice(start, end));
    if (block.length < 20) continue;
    articles.push({
      article: matches[i].title.match(/^제\d+조(?:의\d+)?/)?.[0] ?? matches[i].title,
      title: matches[i].title,
      text: block,
    });
  }
  return articles;
}

function selectRelevantArticles(record, text) {
  const keyword = categoryKeywords[record.categoryId] ?? /안전|계획|점검|허가|신고|관계기관/;
  const articles = splitArticles(text);
  const selected = articles
    .filter((article) => keyword.test(article.text))
    .slice(0, 12)
    .map((article) => ({
      article: article.article,
      title: article.title,
      textExcerpt: article.text.length > 360 ? `${article.text.slice(0, 360)}...` : article.text,
      source: "law.go.kr official HTML",
      verifiedAt: today,
    }));
  return selected.length > 0 ? selected : articles.slice(0, 6).map((article) => ({
    article: article.article,
    title: article.title,
    textExcerpt: article.text.length > 360 ? `${article.text.slice(0, 360)}...` : article.text,
    source: "law.go.kr official HTML",
    verifiedAt: today,
  }));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const pack = JSON.parse(readFileSync(packPath, "utf8"));
const records = pack.records ?? [];
const targets = records.filter((record) =>
  priorityJurisdictions.has(record.jurisdiction)
  && ["source_verified", "needs_review"].includes(record.verificationStatus)
);

const results = [];
for (const record of targets) {
  try {
    const body = await fetchOrdinanceBody(record);
    const articleExtracts = selectRelevantArticles(record, body.text);
    if (articleExtracts.length > 0) {
      record.articleExtracts = articleExtracts;
      record.verificationStatus = "article_verified";
      record.sourceConfidence = "official_law_go_html_article_snapshot";
      record.articleVerification = {
        method: "law_go_official_html_snapshot",
        verifiedAt: today,
        sourceUrl: body.sourceUrl,
        extractedArticles: articleExtracts.length,
      };
      if (body.effectiveAt) record.effectiveAt = body.effectiveAt;
    }
    results.push({ id: record.id, jurisdiction: record.jurisdiction, status: "verified", articles: articleExtracts.length });
  } catch (error) {
    record.verificationStatus = record.verificationStatus === "needs_review" ? "needs_review" : "source_verified";
    record.articleVerification = {
      method: "law_go_official_html_snapshot",
      verifiedAt: today,
      status: "failed",
      reason: String(error.message ?? error).slice(0, 180),
    };
    results.push({ id: record.id, jurisdiction: record.jurisdiction, status: "failed", reason: String(error.message ?? error) });
  }
  await sleep(120);
}

pack.priorityArticleVerification = {
  generatedAt: today,
  method: "law.go.kr official HTML ordinInfoP/ordinInfoR snapshot without storing API keys",
  targetJurisdictions: [...priorityJurisdictions].sort((a, b) => a.localeCompare(b, "ko")),
  verifiedRecords: results.filter((result) => result.status === "verified").length,
  failedRecords: results.filter((result) => result.status === "failed").length,
};

writeFileSync(packPath, `${JSON.stringify(pack, null, 2)}\n`);
console.log(JSON.stringify(pack.priorityArticleVerification, null, 2));
