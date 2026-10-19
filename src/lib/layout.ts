import {
  LAYOUT_VERSION,
  type PageLayout,
  type Quad,
  type TranslationBlock,
} from "../types";
import { sha256 } from "./hash";

export interface TextRun {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  font: string;
  itemIndex: number;
  quad?: Quad;
  rotated?: boolean;
}
interface Line {
  text: string;
  x: number;
  y: number;
  right: number;
  bottom: number;
  height: number;
  font: string;
  runs: TextRun[];
}
const median = (ns: number[]) =>
  ns.length ? [...ns].sort((a, b) => a - b)[Math.floor(ns.length / 2)] : 0;
const rectQuad = (x: number, y: number, r: number, b: number): Quad =>
  [
    [x, y],
    [r, y],
    [r, b],
    [x, b],
  ].map((p) => p.map((n) => Math.max(0, Math.min(1, n)))) as Quad;
export function normalizeParagraph(lines: string[]) {
  return lines
    .join("\n")
    .replace(/([a-z]{2,})-\n([a-z]{2,})/g, "$1$2")
    .replace(/\s*\n\s*/g, " ")
    .replace(/[\t ]+/g, " ")
    .trim();
}
// A gutter must be empty across many text runs and have sustained text on both sides.
// Full-width titles are deliberately omitted from the vote, then partitioned into their own regions.
export function findGutter(runs: TextRun[]): number | undefined {
  const narrow = runs.filter((r) => r.width < 0.76 && r.text.trim().length > 2);
  if (narrow.length < 6) return;
  let best: { x: number; score: number } | undefined;
  for (let x = 0.2; x <= 0.8; x += 0.005) {
    const left = narrow.filter((r) => r.x + r.width <= x - 0.006),
      right = narrow.filter((r) => r.x >= x + 0.006);
    const cross = narrow.filter((r) => r.x < x && r.x + r.width > x);
    if (
      left.length < 3 ||
      right.length < 3 ||
      cross.length > Math.min(left.length, right.length) * 0.14
    )
      continue;
    const lEdge = Math.max(...left.map((r) => r.x + r.width)),
      rEdge = Math.min(...right.map((r) => r.x));
    const overlap =
      Math.min(
        Math.max(...left.map((r) => r.y)),
        Math.max(...right.map((r) => r.y)),
      ) -
      Math.max(
        Math.min(...left.map((r) => r.y)),
        Math.min(...right.map((r) => r.y)),
      );
    if (rEdge - lEdge < 0.018 || overlap < 0.035) continue;
    const score =
      Math.min(left.length, right.length) -
      cross.length * 5 +
      (rEdge - lEdge) * 10;
    if (!best || score > best.score) best = { x: (lEdge + rEdge) / 2, score };
  }
  return best?.x;
}
function rebuildLines(runs: TextRun[]): Line[] {
  const rows: TextRun[][] = [];
  for (const run of [...runs].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const row = rows.findLast(
      (row) =>
        Math.abs(row[0].y - run.y) < Math.min(row[0].height, run.height) * 0.42,
    );
    if (row) row.push(run);
    else rows.push([run]);
  }
  return rows
    .map((row) => {
      row.sort((a, b) => a.x - b.x);
      let text = "";
      row.forEach((r, i) => {
        const prev = row[i - 1];
        text += `${prev && r.x - (prev.x + prev.width) > Math.min(r.height * 0.12, 0.003) && !text.endsWith(" ") ? " " : ""}${r.text}`;
      });
      return {
        text: text.trim(),
        x: Math.min(...row.map((r) => r.x)),
        y: Math.min(...row.map((r) => r.y)),
        right: Math.max(...row.map((r) => r.x + r.width)),
        bottom: Math.max(...row.map((r) => r.y + r.height)),
        height: median(row.map((r) => r.height)),
        font: row[0].font,
        runs: row,
      };
    })
    .filter((l) => l.text);
}
function classify(lines: Line[], bodyHeight: number) {
  const content = lines.map((l) => l.text).join(" "),
    first = lines[0];
  if (/^\d{1,4}$/.test(content) && (first.y < 0.08 || first.bottom > 0.92))
    return {
      role: "header-footer" as const,
      eligibility: "excluded" as const,
      warnings: ["純頁碼，不自動翻譯"],
    };
  if (!/[a-zA-Z\u3400-\u9fff]{3,}/.test(content) && /[=∑∫√±<>]/.test(content))
    return {
      role: "formula" as const,
      eligibility: "excluded" as const,
      warnings: ["純公式，不自動翻譯"],
    };
  const tableRows = lines.filter(
    (l) =>
      l.runs.filter(
        (r, i, rs) => i && r.x - rs[i - 1].x - rs[i - 1].width > 0.025,
      ).length >= 2,
  );
  if (tableRows.length >= 2 || lines.some((l) => l.runs.some((r) => r.rotated)))
    return {
      role: "table" as const,
      eligibility: "review" as const,
      warnings: ["表格或旋轉文字，請檢查擷取順序後單獨翻譯"],
    };
  const role = /^(figure|fig\.|table)\s*\d/i.test(content)
    ? "caption"
    : first.height > bodyHeight * 1.22 ||
        (lines.length === 1 && /bold|black|heavy/i.test(first.font))
      ? "heading"
      : /^\[\d+\]/.test(content)
        ? "reference"
        : first.y > 0.82 && first.height < bodyHeight * 0.88
          ? "footnote"
          : "body";
  return {
    role: role as TranslationBlock["role"],
    eligibility: "ready" as const,
    warnings: [] as string[],
  };
}
export async function analyzeLayout(
  documentId: string,
  documentHash: string,
  pageIndex: number,
  input: TextRun[],
  meta: Omit<
    PageLayout,
    "documentId" | "pageIndex" | "text" | "warnings" | "regions"
  >,
): Promise<{ page: PageLayout; blocks: TranslationBlock[] }> {
  const seen = new Set<string>();
  const runs = input.filter((r) => {
    if (!r.text.trim() || r.width <= 0 || r.height <= 0) return false;
    const key = `${r.text}:${r.x.toFixed(4)}:${r.y.toFixed(4)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const gutter = findGutter(runs),
    bodyHeight = median(runs.map((r) => r.height)) || 0.015;
  const spanning =
    gutter === undefined
      ? []
      : runs.filter(
          (r) => r.x < gutter - 0.008 && r.x + r.width > gutter + 0.008,
        );
  const spanBands: { top: number; bottom: number }[] = [];
  for (const r of spanning.sort((a, b) => a.y - b.y)) {
    const prev = spanBands.at(-1);
    if (prev && r.y - prev.bottom < bodyHeight * 0.65)
      prev.bottom = Math.max(prev.bottom, r.y + r.height);
    else spanBands.push({ top: r.y, bottom: r.y + r.height });
  }
  const buckets = new Map<string, TextRun[]>();
  for (const r of runs) {
    const band = spanBands.findIndex(
      (b) =>
        r.y + r.height * 0.5 >= b.top - bodyHeight * 0.3 &&
        r.y + r.height * 0.5 <= b.bottom + bodyHeight * 0.3,
    );
    const segment = spanBands.filter((b) => b.bottom < r.y).length;
    const key =
      gutter === undefined
        ? "region-0:column-0"
        : band >= 0
          ? `region-${band * 2 + 1}:full`
          : `region-${segment * 2}:${r.x + r.width * 0.5 < gutter ? "left" : "right"}`;
    buckets.set(key, [...(buckets.get(key) || []), r]);
  }
  const blocks: TranslationBlock[] = [],
    regions: PageLayout["regions"] = [];
  const ordered = [...buckets.entries()].sort(
    (a, b) =>
      Number(a[0].split(":")[0].slice(7)) -
        Number(b[0].split(":")[0].slice(7)) || a[0].localeCompare(b[0]),
  );
  for (const [key, items] of ordered) {
    const [regionId, columnId] = key.split(":");
    let region = regions.find((r) => r.id === regionId);
    if (!region) {
      region = { id: regionId, columns: [] };
      regions.push(region);
    }
    region.columns.push(columnId);
    const lines = rebuildLines(items),
      groups: Line[][] = [];
    const gaps = lines
      .slice(1)
      .map((l, i) => l.y - lines[i].y)
      .filter((g) => g > bodyHeight * 0.7 && g < bodyHeight * 2.2);
    const pitch = median(gaps) || bodyHeight * 1.3;
    const leftEdge = Math.min(...lines.map((l) => l.x)),
      rightEdge = Math.max(...lines.map((l) => l.right));
    for (const line of lines) {
      const previous = groups.at(-1)?.at(-1);
      const fontChange =
        previous && Math.abs(line.height - previous.height) > bodyHeight * 0.2;
      const indent =
        previous &&
        line.x - leftEdge > bodyHeight * 0.65 &&
        previous.x - leftEdge < bodyHeight * 0.4;
      const endedShort =
        previous &&
        rightEdge - previous.right > (rightEdge - leftEdge) * 0.2 &&
        /[.!?:;。]$/.test(previous.text);
      const list = /^(?:[•●▪]|\d+[.)]\s|[a-z][.)]\s)/.test(line.text);
      const gap = previous ? line.y - previous.y : 0;
      if (
        !previous ||
        gap > pitch * 1.4 ||
        fontChange ||
        indent ||
        endedShort ||
        list
      )
        groups.push([line]);
      else groups.at(-1)!.push(line);
    }
    for (const group of groups) {
      const rawText = group.map((l) => l.text).join("\n"),
        normalizedText = normalizeParagraph(group.map((l) => l.text));
      const sourceHash = await sha256(normalizedText);
      const sources = group
        .flatMap((l) => l.runs.map((r) => `${r.itemIndex}:0:${r.text.length}`))
        .join("|");
      const id = await sha256(
        `${documentHash}:${LAYOUT_VERSION}:${pageIndex}:${key}:${sources}`,
      );
      const quality = classify(group, bodyHeight);
      blocks.push({
        id,
        documentId,
        pageIndex,
        regionId,
        columnId,
        order: blocks.length,
        ...quality,
        rawText,
        normalizedText,
        sourceHash,
        layoutVersion: LAYOUT_VERSION,
        lines: group.map((l) => ({
          text: l.text,
          quad: rectQuad(l.x, l.y, l.right, l.bottom),
          sources: l.runs.map((r) => ({
            itemIndex: r.itemIndex,
            start: 0,
            end: r.text.length,
          })),
        })),
        boundary: group[0].y < 0.13 || group.at(-1)!.bottom > 0.85,
        confidence: quality.eligibility === "review" ? 0.45 : 0.86,
      });
    }
  }
  return {
    page: {
      ...meta,
      documentId,
      pageIndex,
      regions,
      text: blocks.map((b) => b.normalizedText).join("\n\n"),
      warnings: runs.length ? [] : ["需要 OCR：此頁沒有可擷取的文字層"],
    },
    blocks,
  };
}
