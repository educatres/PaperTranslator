import JSZip from "jszip";
import { z } from "zod";
import {
  APP_ID,
  now,
  uid,
  usesReasoningEffort,
  workspaceInputSchema,
  upgradeWorkspace,
  type Workspace,
} from "../types";
import { sha256 } from "./hash";
import { db, useApp } from "./storage";

export const LIMITS = {
  pdf: 150 * 1024 * 1024,
  pack: 200 * 1024 * 1024,
  total: 300 * 1024 * 1024,
  json: 30 * 1024 * 1024,
  entries: 10200,
};
const fileMeta = z
  .object({
    documentId: z.string(),
    path: z.string(),
    size: z.number().int().positive().max(LIMITS.pdf),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
const manifestSchema = z
  .object({
    appId: z.literal(APP_ID),
    schemaVersion: z.union([z.literal(1), z.literal(2)]),
    title: z.string().max(200),
    exportedAt: z.string(),
    research: z
      .object({
        path: z.literal("research.json"),
        size: z.number().int().positive().max(LIMITS.json),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .strict(),
    documents: z.array(fileMeta).max(50),
  })
  .strict();
function unique(values: string[], name: string) {
  if (new Set(values).size !== values.length)
    throw new Error(`${name} 包含重複 ID。`);
}
export async function validateWorkspace(input: unknown): Promise<Workspace> {
  const w = workspaceInputSchema.parse(input);
  for (const key of [
    "documents",
    "blocks",
    "results",
    "summaries",
    "jobs",
    "annotations",
  ] as const)
    unique(
      w[key].map((x) => x.id),
      key,
    );
  unique(
    w.documents.map((d) => d.sha256),
    "文件 hash",
  );
  unique(
    w.pages.map((p) => `${p.documentId}:${p.pageIndex}`),
    "頁面",
  );
  const docs = new Map(w.documents.map((d) => [d.id, d])),
    blocks = new Map(w.blocks.map((b) => [b.id, b])),
    results = new Map(w.results.map((r) => [r.id, r]));
  const pages = new Map(
    w.pages.map((p) => [`${p.documentId}:${p.pageIndex}`, p]),
  );
  for (const a of w.annotations) {
    const doc = docs.get(a.documentId);
    if (
      !doc ||
      doc.sha256 !== a.documentHash ||
      a.anchors.some(
        (anchor) =>
          anchor.pageIndex >= doc.pageCount ||
          !pages.has(`${doc.id}:${anchor.pageIndex}`),
      ) ||
      (await sha256(a.quote)) !== a.sourceHash
    )
      throw new Error("標註來源或位置無效。");
    unique(
      a.anchors.map((anchor) => String(anchor.pageIndex)),
      "標註頁面",
    );
    const ai = a.kind === "translation" || a.kind === "summary";
    if (
      (!ai && (a.results.length || a.config || a.status !== "idle")) ||
      (a.kind !== "note" && !a.quote.trim()) ||
      (ai && a.quote.length > 6000) ||
      (ai && a.status !== "idle" && !a.config) ||
      (ai && a.status === "complete" && !a.results.length) ||
      (a.config &&
        !usesReasoningEffort(a.config.provider) &&
        a.config.reasoningEffort) ||
      a.results.some(
        (r) =>
          !r.text.trim() ||
          (!usesReasoningEffort(r.provider) && r.reasoningEffort),
      )
    )
      throw new Error("標註內容或生成狀態無效。");
  }
  for (const p of w.pages) {
    const d = docs.get(p.documentId);
    if (!d || p.pageIndex >= d.pageCount) throw new Error("無效頁碼。");
    unique(
      p.regions.map((r) => r.id),
      "區域",
    );
    p.regions.forEach((r) => unique(r.columns, "欄位"));
  }
  for (const b of w.blocks) {
    const d = docs.get(b.documentId),
      p = pages.get(`${b.documentId}:${b.pageIndex}`);
    if (
      !d ||
      !p ||
      b.layoutVersion !== d.layoutVersion ||
      !p.regions.some(
        (r) => r.id === b.regionId && r.columns.includes(b.columnId),
      )
    )
      throw new Error("段落來源頁面或欄位無效。");
    if ((await sha256(b.normalizedText)) !== b.sourceHash)
      throw new Error("段落原文校驗失敗。");
    if (b.lines.some((l) => l.sources.some((s) => s.end <= s.start)))
      throw new Error("來源字元範圍無效。");
    const sources = b.lines
      .flatMap((l) =>
        l.sources.map((s) => `${s.itemIndex}:${s.start}:${s.end}`),
      )
      .join("|");
    if (
      (await sha256(
        `${d.sha256}:${b.layoutVersion}:${b.pageIndex}:${b.regionId}:${b.columnId}:${sources}`,
      )) !== b.id
    )
      throw new Error("段落穩定識別碼無效。");
    if (b.currentResultId) {
      const r = results.get(b.currentResultId);
      if (
        !r ||
        r.blockId !== b.id ||
        r.sourceHash !== b.sourceHash ||
        r.layoutVersion !== b.layoutVersion
      )
        throw new Error("有效譯文參照錯誤。");
    }
  }
  for (const r of w.results) {
    const b = blocks.get(r.blockId);
    if (
      !b ||
      r.sourceHash !== b.sourceHash ||
      r.layoutVersion !== b.layoutVersion ||
      !r.text.trim() ||
      !r.partIds.length
    )
      throw new Error("譯文來源或內容無效。");
  }
  const allPartIds = new Set<string>();
  for (const j of w.jobs) {
    const d = docs.get(j.documentId);
    if (
      !d ||
      j.layoutVersion !== d.layoutVersion ||
      j.documentHash !== d.sha256
    )
      throw new Error("任務版本無效。");
    if (!usesReasoningEffort(j.config.provider) && j.config.reasoningEffort)
      throw new Error("此供應商不使用推理程度欄位。");
    unique(j.blockIds, "任務目標");
    unique(
      j.parts.map((p) => p.id),
      "子片段",
    );
    const validConfig = (r: {
      text: string;
      provider: string;
      model: string;
      reasoningEffort?: string;
    }) =>
      r.text.trim() &&
      r.provider === j.config.provider &&
      r.model === j.config.model &&
      r.reasoningEffort === j.config.reasoningEffort;
    for (const p of j.parts) {
      if (allPartIds.has(p.id)) throw new Error("子片段識別碼衝突。");
      allPartIds.add(p.id);
      if (!j.blockIds.includes(p.blockId))
        throw new Error("子片段未指向任務目標。");
      if (
        (p.status === "translated") !== !!p.result ||
        (p.result && !validConfig(p.result))
      )
        throw new Error("子片段狀態與結果不一致。");
    }
    for (const id of j.blockIds) {
      const b = blocks.get(id);
      if (!b || b.documentId !== j.documentId)
        throw new Error("任務目標不存在。");
      const parts = j.parts.filter((p) => p.blockId === id);
      let end = 0;
      parts.forEach((p, i) => {
        if (
          p.partIndex !== i ||
          p.start !== end ||
          p.end > b.normalizedText.length ||
          p.text !== b.normalizedText.slice(p.start, p.end)
        )
          throw new Error("子片段來源範圍無效。");
        end = p.end;
      });
      if (!parts.length || end !== b.normalizedText.length)
        throw new Error("子片段未完整涵蓋來源。");
      if (
        j.status === "complete" &&
        (parts.some((p) => !p.result) ||
          !w.results.some(
            (r) =>
              r.blockId === id &&
              r.partIds.length === parts.length &&
              r.partIds.every((partId, i) => partId === parts[i].id),
          ))
      )
        throw new Error("任務完成狀態無效。");
    }
    for (const c of [...j.chunks, ...j.reductions])
      if (
        c.startPage > c.endPage ||
        c.endPage > d.pageCount ||
        (c.result && !validConfig(c.result))
      )
        throw new Error("摘要來源頁碼或結果設定無效。");
    if (
      j.kind === "summary" &&
      (!j.chunks.length || j.blockIds.length || j.parts.length)
    )
      throw new Error("摘要任務結構無效。");
    if (
      j.kind === "translation" &&
      (!j.blockIds.length || j.chunks.length || j.reductions.length)
    )
      throw new Error("翻譯任務結構無效。");
    if (
      j.kind === "summary" &&
      j.status === "complete" &&
      !w.summaries.some((s) => s.id === j.resultId && s.jobId === j.id)
    )
      throw new Error("摘要完成結果不存在。");
  }
  for (const r of w.results) {
    unique(r.partIds, "譯文來源");
    const jobs = w.jobs.filter((j) =>
      j.parts.some((p) => r.partIds.includes(p.id)),
    );
    if (jobs.length !== 1) throw new Error("譯文缺少唯一來源任務。");
    const parts = jobs[0].parts.filter((p) => p.blockId === r.blockId);
    if (
      parts.length !== r.partIds.length ||
      parts.some((p, i) => p.id !== r.partIds[i] || !p.result) ||
      parts.map((p) => p.result!.text).join("\n") !== r.text
    )
      throw new Error("譯文來源子片段無效。");
  }
  for (const s of w.summaries) {
    const d = docs.get(s.documentId),
      j = w.jobs.find((j) => j.id === s.jobId);
    if (
      !d ||
      !j ||
      j.documentId !== d.id ||
      j.kind !== "summary" ||
      s.layoutVersion !== d.layoutVersion ||
      s.sourcePages.some(([a, b]) => a > b || b > d.pageCount) ||
      !s.text.trim()
    )
      throw new Error("摘要參照無效。");
  }
  for (const d of w.documents)
    if (
      d.currentSummaryId &&
      !w.summaries.some(
        (s) => s.id === d.currentSummaryId && s.documentId === d.id,
      )
    )
      throw new Error("目前摘要不存在。");
  return w;
}
export function pausedSnapshot(w: Workspace) {
  const next = structuredClone(upgradeWorkspace(w));
  for (const a of next.annotations)
    if (a.status === "running") a.status = "paused";
  for (const j of next.jobs) {
    delete j.owner;
    delete j.heartbeat;
    if (j.status === "running" || j.status === "pending") j.status = "paused";
    for (const p of j.parts) if (p.status === "running") p.status = "pending";
  }
  return next;
}
export async function snapshot() {
  return db.transaction("r", db.research, db.files, async () => ({
    workspace: pausedSnapshot(
      useApp.getState().unsavedDraft ||
        (await db.research.get("workspace"))!.data,
    ),
    files: await db.files.toArray(),
  }));
}
export async function exportPack(): Promise<Blob> {
  const { workspace: w, files } = await snapshot();
  await validateWorkspace(w);
  const research = new TextEncoder().encode(JSON.stringify(w));
  if (research.byteLength > LIMITS.json)
    throw new Error("研究資料超過 30 MB，請拆分研究。");
  const zip = new JSZip();
  zip.file("research.json", research);
  const documents: z.infer<typeof fileMeta>[] = [];
  let total = research.byteLength;
  for (const d of w.documents) {
    const stored = files.find((f) => f.id === d.id);
    if (!stored)
      throw new Error(
        `缺少「${d.name}」原檔，請先補回 PDF，或使用 JSON 匯出。`,
      );
    const bytes = await stored.blob.arrayBuffer();
    total += bytes.byteLength;
    if (total > LIMITS.total)
      throw new Error("研究封裝解壓總量超過 300 MB，請拆分研究。");
    if (bytes.byteLength !== d.size || (await sha256(bytes)) !== d.sha256)
      throw new Error("本機 PDF 校驗失敗，請補回原檔。");
    const path = `documents/${d.id}.pdf`;
    zip.file(path, bytes);
    documents.push({ documentId: d.id, path, size: d.size, sha256: d.sha256 });
  }
  zip.file(
    "manifest.json",
    JSON.stringify({
      appId: APP_ID,
      schemaVersion: 2,
      title: w.title,
      exportedAt: now(),
      research: {
        path: "research.json",
        size: research.byteLength,
        sha256: await sha256(research),
      },
      documents,
    }),
  );
  const blob = await zip.generateAsync({
    type: "blob",
    compression: "DEFLATE",
  });
  if (blob.size > LIMITS.pack)
    throw new Error("壓縮封裝超過 200 MB，請拆分研究。");
  return blob;
}
// Inspect raw central-directory entries before JSZip normalizes paths or overwrites duplicates.
export function inspectZip(data: ArrayBuffer) {
  const v = new DataView(data);
  let end = -1;
  for (
    let p = data.byteLength - 22;
    p >= Math.max(0, data.byteLength - 65557);
    p--
  )
    if (
      v.getUint32(p, true) === 0x06054b50 &&
      p + 22 + v.getUint16(p + 20, true) === data.byteLength
    ) {
      end = p;
      break;
    }
  if (end < 0) throw new Error("封裝 ZIP 目錄損毀。");
  const count = v.getUint16(end + 10, true),
    size = v.getUint32(end + 12, true),
    offset = v.getUint32(end + 16, true);
  if (
    v.getUint16(end + 4, true) ||
    v.getUint16(end + 6, true) ||
    count === 65535 ||
    count > LIMITS.entries ||
    count !== v.getUint16(end + 8, true) ||
    offset + size !== end
  )
    throw new Error("不支援多卷、ZIP64 或超限封裝。");
  let p = offset,
    total = 0;
  const names = new Set<string>();
  for (let i = 0; i < count; i++) {
    if (p + 46 > end || v.getUint32(p, true) !== 0x02014b50)
      throw new Error("ZIP entry 無效。");
    const flags = v.getUint16(p + 8, true),
      uncompressed = v.getUint32(p + 24, true),
      len = v.getUint16(p + 28, true),
      extra = v.getUint16(p + 30, true),
      comment = v.getUint16(p + 32, true);
    const name = new TextDecoder("utf-8", { fatal: true }).decode(
      data.slice(p + 46, p + 46 + len),
    );
    if (
      flags & 1 ||
      !name ||
      name.startsWith("/") ||
      name.includes("\\") ||
      name.includes(":") ||
      name.includes("\0") ||
      name.split("/").some((n) => n === "." || n === "..") ||
      names.has(name)
    )
      throw new Error("封裝包含不安全路徑、加密或重複 entry。");
    if (
      uncompressed === 0xffffffff ||
      uncompressed > LIMITS.total ||
      (total += uncompressed) > LIMITS.total
    )
      throw new Error("封裝解壓大小超限。");
    names.add(name);
    p += 46 + len + extra + comment;
  }
  if (p !== end) throw new Error("ZIP 目錄大小不符。");
  return names;
}
async function limitedRead(entry: JSZip.JSZipObject, max: number) {
  interface Stream {
    on(
      event: "data" | "error" | "end",
      callback: (value: never) => void,
    ): Stream;
    pause(): void;
    resume(): void;
  }
  const object = entry as unknown as { internalStream(type: string): Stream };
  return new Promise<Uint8Array>((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let length = 0,
      failed = false;
    const stream = object.internalStream("uint8array");
    stream
      .on("data", (chunk: Uint8Array) => {
        length += chunk.length;
        if (length > max) {
          failed = true;
          stream.pause();
          reject(new Error("封裝實際解壓大小超限。"));
          return;
        }
        chunks.push(chunk);
      })
      .on("error", reject)
      .on("end", () => {
        if (failed) return;
        const result = new Uint8Array(length);
        let pos = 0;
        for (const c of chunks) {
          result.set(c, pos);
          pos += c.length;
        }
        resolve(result);
      });
    stream.resume();
  });
}
export interface ImportData {
  workspace: Workspace;
  files: { id: string; blob: Blob }[];
  warnings: string[];
}
export async function readImport(file: File): Promise<ImportData> {
  if (file.name.toLowerCase().endsWith(".json")) {
    if (file.size > LIMITS.json) throw new Error("JSON 超過 30 MB。");
    const workspace = await validateWorkspace(JSON.parse(await file.text()));
    return {
      workspace: pausedSnapshot(workspace),
      files: [],
      warnings: ["JSON 不含 PDF 原檔；請匯入相同 SHA-256 的 PDF 補回。"],
    };
  }
  if (file.size > LIMITS.pack) throw new Error("研究封裝超過 200 MB。");
  const data = await file.arrayBuffer(),
    names = inspectZip(data),
    zip = await JSZip.loadAsync(data);
  const m = zip.file("manifest.json"),
    r = zip.file("research.json");
  if (!m || !r)
    throw new Error(
      "缺少新格式 manifest 或研究資料。PaperReader 封裝尚不支援遷移。",
    );
  const manifestBytes = await limitedRead(m, 1024 * 1024),
    manifest = manifestSchema.parse(
      JSON.parse(new TextDecoder().decode(manifestBytes)),
    );
  const research = await limitedRead(r, LIMITS.json);
  if (
    research.byteLength !== manifest.research.size ||
    (await sha256(research)) !== manifest.research.sha256
  )
    throw new Error("研究資料校驗失敗。");
  const rawResearch = JSON.parse(new TextDecoder().decode(research));
  if (rawResearch.schemaVersion !== manifest.schemaVersion)
    throw new Error("manifest 與研究資料的版本不符。");
  const workspace = await validateWorkspace(rawResearch);
  if (
    manifest.documents.length !== workspace.documents.length ||
    manifest.title !== workspace.title
  )
    throw new Error("manifest 文件數或名稱不符。");
  unique(
    manifest.documents.map((d) => d.documentId),
    "封裝文件",
  );
  const expected = new Set([
    "manifest.json",
    "research.json",
    "documents/",
    ...manifest.documents.map((d) => d.path),
  ]);
  for (const name of names)
    if (!expected.has(name)) throw new Error("封裝包含未宣告的檔案。");
  let total = research.byteLength + manifestBytes.byteLength;
  const files: ImportData["files"] = [];
  for (const meta of manifest.documents) {
    const doc = workspace.documents.find((d) => d.id === meta.documentId);
    if (
      !doc ||
      meta.path !== `documents/${doc.id}.pdf` ||
      meta.sha256 !== doc.sha256 ||
      meta.size !== doc.size
    )
      throw new Error("PDF 清單關聯錯誤。");
    const entry = zip.file(meta.path);
    if (!entry) throw new Error("封裝缺少 PDF。");
    const bytes = await limitedRead(
      entry,
      Math.min(LIMITS.pdf, LIMITS.total - total),
    );
    total += bytes.byteLength;
    if (
      bytes.byteLength !== meta.size ||
      (await sha256(bytes)) !== meta.sha256 ||
      !new TextDecoder().decode(bytes.slice(0, 1024)).includes("%PDF-")
    )
      throw new Error("PDF 校驗失敗。");
    const { getDocument } = await import("pdfjs-dist");
    const { pdfOptions } = await import("./pdf");
    let pdf;
    try {
      pdf = await getDocument({ ...pdfOptions, data: bytes.slice() }).promise;
      if (pdf.numPages !== doc.pageCount) throw new Error("PDF 頁數不符。");
    } finally {
      await pdf?.loadingTask.destroy();
    }
    files.push({
      id: doc.id,
      blob: new Blob([bytes as BlobPart], { type: "application/pdf" }),
    });
  }
  return { workspace: pausedSnapshot(workspace), files, warnings: [] };
}
export function markdown(w: Workspace) {
  let out = `# ${w.title}\n\nPaperTranslator · ${now()}\n\n`;
  for (const d of w.documents) {
    out += `## ${d.name}\n\n`;
    const summary = w.summaries.find((s) => s.id === d.currentSummaryId);
    if (summary)
      out += `### 全文摘要\n\n${summary.text}\n\n${summary.provider} / ${summary.model} · ${summary.createdAt}\n\n`;
    for (const a of w.annotations.filter((a) => a.documentId === d.id)) {
      const labels = {
        highlight: "螢光標記",
        note: "便條貼",
        translation: "選取翻譯",
        summary: "選取摘要",
      };
      out += `### ${labels[a.kind]} · ${a.color} · p. ${a.anchors.map((anchor) => anchor.pageIndex + 1).join(", ")}\n\n${a.quote ? `原文：${a.quote}\n\n` : ""}${a.content ? a.content + "\n\n" : ""}${a.results.at(-1)?.text || ""}\n\n`;
    }
    for (const b of w.blocks
      .filter((b) => b.documentId === d.id)
      .sort((a, b) => a.pageIndex - b.pageIndex || a.order - b.order)) {
      const r = w.results.find((r) => r.id === b.currentResultId);
      out += `### p. ${b.pageIndex + 1} · ${b.columnId} · 段落 ${b.order + 1}\n\n${b.normalizedText}\n\n${r ? `${r.text}\n\n${r.provider} / ${r.model} · ${r.createdAt}` : "（尚未翻譯）"}\n\n`;
    }
  }
  return out;
}
export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name.replace(/[<>:"/\\|?*]/g, "_");
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
export async function exportJSON() {
  const { workspace } = await snapshot();
  const blob = new Blob([JSON.stringify(workspace, null, 2)], {
    type: "application/json",
  });
  if (blob.size > LIMITS.json) throw new Error("JSON 超過 30 MB，請拆分研究。");
  download(blob, `${workspace.title}.json`);
}
export async function exportMarkdown() {
  const { workspace } = await snapshot();
  download(
    new Blob([markdown(workspace)], { type: "text/markdown;charset=utf-8" }),
    `${workspace.title}.md`,
  );
}
