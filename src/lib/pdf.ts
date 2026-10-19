import {
  getDocument,
  GlobalWorkerOptions,
  TextLayer,
  Util,
  type PDFDocumentProxy,
} from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { analyzeLayout, type TextRun } from "./layout";
import { sha256 } from "./hash";
import { activate, db, mutate, toast, useApp } from "./storage";
import { LAYOUT_VERSION, NS, now, uid, type Paper } from "../types";
GlobalWorkerOptions.workerSrc = workerUrl;
export const pdfOptions = {
  cMapUrl: `${import.meta.env.BASE_URL}pdfjs/cmaps/`,
  cMapPacked: true,
  standardFontDataUrl: `${import.meta.env.BASE_URL}pdfjs/standard_fonts/`,
  wasmUrl: `${import.meta.env.BASE_URL}pdfjs/wasm/`,
  isEvalSupported: false,
};
const cache = new Map<string, Promise<PDFDocumentProxy>>();
const ascentCache = new Map<string, number>();
function fontAscent(family: string, fallback: number) {
  const mapped = TextLayer.fontFamilyMap.get(family) || family;
  if (!ascentCache.has(mapped)) {
    // Match PDF.js TextLayer's font metrics so persisted line boxes also align with text selection.
    const context = document.createElement("canvas").getContext("2d");
    if (!context) return fallback;
    context.font = `30px ${mapped}`;
    const metrics = context.measureText("");
    const ascent = metrics.fontBoundingBoxAscent,
      descent = Math.abs(metrics.fontBoundingBoxDescent);
    ascentCache.set(mapped, ascent ? ascent / (ascent + descent) : fallback);
  }
  return ascentCache.get(mapped)!;
}
export function resetPdfCache() {
  const old = [...cache.values()];
  cache.clear();
  old.forEach(
    (p) => void p.then((d) => d.loadingTask.destroy()).catch(() => {}),
  );
}
window.addEventListener(`${NS}.reset`, resetPdfCache);
export async function openPaper(paper: Paper) {
  const key = `${paper.id}:${paper.sha256}`;
  if (!cache.has(key))
    cache.set(
      key,
      (async () => {
        const stored = await db.files.get(paper.id);
        if (!stored)
          throw new Error(
            "缺少 PDF 原檔。請匯入相同 SHA-256 的原始 PDF 補回；既有譯文與摘要仍可閱讀。",
          );
        return getDocument({
          ...pdfOptions,
          data: new Uint8Array(await stored.blob.arrayBuffer()),
        }).promise;
      })().catch((e) => {
        cache.delete(key);
        throw e;
      }),
    );
  return cache.get(key)!;
}
export async function importPdf(
  file: File,
  progress: (s: string) => void = () => {},
) {
  if (!file.size || file.size > 150 * 1024 * 1024)
    throw new Error("PDF 必須介於 1 byte 與 150 MB。");
  const data = await file.arrayBuffer();
  if (!new TextDecoder().decode(data.slice(0, 1024)).includes("%PDF-"))
    throw new Error("請選擇有效的 PDF 檔案。");
  const hash = await sha256(data);
  const epoch = useApp.getState().workspace.epoch;
  const existing = useApp
    .getState()
    .workspace.documents.find((d) => d.sha256 === hash);
  if (existing && existing.status !== "indexing") {
    await mutate(() => {}, epoch, { id: existing.id, blob: file });
    activate(existing.id);
    toast("已開啟既有文獻，原檔已補回，譯文保持原有對應。");
    return;
  }
  let pdf: PDFDocumentProxy;
  try {
    pdf = await getDocument({ ...pdfOptions, data: new Uint8Array(data) })
      .promise;
  } catch {
    throw new Error("無法讀取 PDF。請確認檔案未損毀且已解除密碼保護。");
  }
  const paper: Paper = existing || {
    id: uid(),
    name: file.name,
    sha256: hash,
    size: file.size,
    pageCount: pdf.numPages,
    layoutVersion: LAYOUT_VERSION,
    status: "indexing",
    createdAt: now(),
  };
  try {
    await mutate(
      (w) => {
        if (!existing) {
          if (w.documents.length >= 50)
            throw new Error("每個研究最多 50 份 PDF，請先備份與整理文獻庫。");
          if (w.documents.some((d) => d.sha256 === hash))
            throw new Error("其他視窗已匯入此文獻，請重新選擇。");
          w.documents.push(paper);
        }
      },
      epoch,
      { id: paper.id, blob: file },
    );
    cache.set(`${paper.id}:${hash}`, Promise.resolve(pdf));
    activate(paper.id);
    for (let pageIndex = 0; pageIndex < pdf.numPages; pageIndex++) {
      if (
        useApp
          .getState()
          .workspace.pages.some(
            (p) => p.documentId === paper.id && p.pageIndex === pageIndex,
          )
      )
        continue;
      progress(`正在辨識段落：第 ${pageIndex + 1}／${pdf.numPages} 頁`);
      const page = await pdf.getPage(pageIndex + 1),
        base = page.getViewport({ scale: 1, rotation: 0 });
      try {
        const content = await page.getTextContent();
        const runs: TextRun[] = content.items.flatMap((item, itemIndex) => {
          if (!("str" in item) || !item.str.trim()) return [];
          const t = Util.transform(base.transform, item.transform),
            height = Math.hypot(t[2], t[3]);
          const style = content.styles[item.fontName];
          const ascent = fontAscent(
            style?.fontFamily || "sans-serif",
            style?.ascent ?? (style?.descent ? 1 + style.descent : 0.8),
          );
          const x = t[4] / base.width,
            y = (t[5] - height * ascent) / base.height;
          return [
            {
              text: item.str,
              x,
              y,
              width:
                (item.width *
                  Math.hypot(base.transform[0], base.transform[1])) /
                base.width,
              height: height / base.height,
              font: item.fontName + (style?.fontFamily || ""),
              itemIndex,
              rotated: Math.abs(t[1]) > Math.abs(t[0]) * 0.2,
            },
          ];
        });
        const layout = await analyzeLayout(paper.id, hash, pageIndex, runs, {
          width: base.width,
          height: base.height,
          nativeRotation: page.rotate,
          viewBox: [...page.view],
          transform: [...base.transform],
        });
        await mutate((w) => {
          if (!w.documents.some((d) => d.id === paper.id))
            throw new Error("文獻已移除。");
          if (
            !w.pages.some(
              (p) => p.documentId === paper.id && p.pageIndex === pageIndex,
            )
          ) {
            w.pages.push(layout.page);
            w.blocks.push(...layout.blocks);
          }
        }, epoch);
      } catch (e) {
        if (useApp.getState().workspace.epoch !== epoch) throw e;
        if (!useApp.getState().saveError)
          await mutate((w) => {
            w.pages.push({
              documentId: paper.id,
              pageIndex,
              width: base.width,
              height: base.height,
              nativeRotation: page.rotate,
              viewBox: [...page.view],
              transform: [...base.transform],
              text: "",
              regions: [],
              warnings: ["這一頁段落辨識失敗，仍可閱讀原始 PDF。"],
            });
          }, epoch);
        else throw e;
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    await mutate((w) => {
      const doc = w.documents.find((d) => d.id === paper.id);
      if (!doc) throw new Error("文獻已移除。");
      doc.status = w.pages
        .filter((p) => p.documentId === doc.id)
        .some((p) => p.warnings.length)
        ? "partial"
        : "ready";
      const edgeBlocks = w.blocks.filter(
        (b) =>
          b.documentId === doc.id &&
          (b.lines[0].quad[0][1] < 0.07 || b.lines.at(-1)!.quad[2][1] > 0.94),
      );
      const signatures = new Map<string, Set<number>>();
      for (const b of edgeBlocks) {
        const s = b.normalizedText.replace(/\d+/g, "#");
        if (!signatures.has(s)) signatures.set(s, new Set());
        signatures.get(s)!.add(b.pageIndex);
      }
      for (const b of edgeBlocks)
        if (
          (signatures.get(b.normalizedText.replace(/\d+/g, "#"))?.size || 0) >=
          Math.max(2, Math.ceil(doc.pageCount * 0.5))
        ) {
          b.role = "header-footer";
          b.eligibility = "excluded";
          b.warnings = ["重複頁首頁尾，不自動翻譯"];
        }
    }, epoch);
    toast("PDF 已保存在本機。點段落旁的圖示開始閱讀。");
  } catch (e) {
    if (
      !existing &&
      !useApp.getState().workspace.documents.some((d) => d.id === paper.id)
    )
      await pdf.loadingTask.destroy();
    throw e;
  }
}
