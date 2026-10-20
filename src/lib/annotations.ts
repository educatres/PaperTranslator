import {
  now,
  uid,
  type Annotation,
  type AnnotationAnchor,
  type AnnotationColor,
  type PageLayout,
  type Quad,
} from "../types";
import { unprojectPoint } from "./geometry";
import { sha256 } from "./hash";
import { mutate, useApp } from "./storage";

export const annotationColors: { id: AnnotationColor; name: string }[] = [
  { id: "yellow", name: "黃色" },
  { id: "green", name: "淺綠" },
  { id: "blue", name: "淺藍" },
  { id: "pink", name: "粉紅" },
];
export const annotationLabels = {
  highlight: "螢光標記",
  note: "便條貼",
  translation: "選取翻譯",
  summary: "選取摘要",
};
export interface TextSelection {
  documentId: string;
  quote: string;
  anchors: AnnotationAnchor[];
}

export function captureTextSelection(
  root: HTMLElement,
  pages: PageLayout[],
  documentId: string,
): TextSelection | undefined {
  const selection = window.getSelection();
  if (!selection?.rangeCount || selection.isCollapsed) return;
  const range = selection.getRangeAt(0);
  const parent = (n: Node) =>
    n.nodeType === Node.ELEMENT_NODE ? (n as HTMLElement) : n.parentElement;
  if (
    ![range.startContainer, range.endContainer].every(
      (n) => root.contains(n) && parent(n)?.closest(".textLayer"),
    )
  )
    return;
  const anchors: AnnotationAnchor[] = [],
    fragments: string[] = [];
  for (const page of root.querySelectorAll<HTMLElement>(".pdf-page.ready")) {
    const index = Number(page.dataset.pageIndex),
      layout = pages.find(
        (p) => p.pageIndex === index && p.documentId === documentId,
      );
    const layer = page.querySelector(".textLayer");
    if (!layout || !layer || !page.dataset.viewport) continue;
    const display = JSON.parse(page.dataset.viewport) as number[],
      bounds = page.getBoundingClientRect();
    const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT),
      quads: Quad[] = [];
    let node: Node | null;
    while ((node = walker.nextNode())) {
      if (!range.intersectsNode(node)) continue;
      const start = node === range.startContainer ? range.startOffset : 0;
      const end =
        node === range.endContainer
          ? range.endOffset
          : node.textContent!.length;
      if (end <= start) continue;
      const part = document.createRange();
      part.setStart(node, start);
      part.setEnd(node, end);
      const value = part.toString();
      if (!value.trim()) continue;
      const rects = [...part.getClientRects()].filter(
        (r) => r.width > 0.2 && r.height > 0.2,
      );
      if (!rects.length) continue;
      fragments.push(value);
      for (const rect of rects) {
        const points: [number, number][] = [
          [rect.left, rect.top],
          [rect.right, rect.top],
          [rect.right, rect.bottom],
          [rect.left, rect.bottom],
        ];
        quads.push(
          points.map((p) =>
            unprojectPoint(
              [p[0] - bounds.left, p[1] - bounds.top],
              layout,
              display,
            ),
          ) as Quad,
        );
      }
    }
    if (quads.length) anchors.push({ pageIndex: index, quads });
  }
  const quote = fragments.join(" ").replace(/\s+/g, " ").trim();
  if (quote && anchors.length) return { documentId, quote, anchors };
}

export async function addAnnotation(
  source: TextSelection,
  kind: Annotation["kind"],
  color: AnnotationColor,
) {
  if (
    source.quote.length > 50000 ||
    source.anchors.length > 100 ||
    source.anchors.some((a) => a.quads.length > 5000)
  )
    throw new Error("選取範圍太大，請分次標註。");
  if (
    (kind === "summary" || kind === "translation") &&
    source.quote.length > 6000
  )
    throw new Error("選取的 AI 內容上限為 6,000 字元，請縮小範圍。");
  const state = useApp.getState(),
    doc = state.workspace.documents.find((d) => d.id === source.documentId);
  if (!doc) throw new Error("來源文獻不存在。");
  const annotation: Annotation = {
    id: uid(),
    documentId: doc.id,
    documentHash: doc.sha256,
    kind,
    color,
    anchors: source.anchors,
    quote: source.quote,
    sourceHash: await sha256(source.quote),
    content: "",
    status: "idle",
    results: [],
    createdAt: now(),
    updatedAt: now(),
  };
  await mutate((w) => {
    if (!w.documents.some((d) => d.id === doc.id && d.sha256 === doc.sha256))
      throw new Error("來源文獻已變更。");
    if (w.annotations.length >= 50000)
      throw new Error("研究已達標註數量上限。");
    w.annotations.push(annotation);
  }, state.workspace.epoch);
  return annotation.id;
}

export async function editAnnotation(
  id: string,
  patch: Pick<Partial<Annotation>, "color" | "content">,
) {
  if (patch.content && patch.content.length > 50000)
    throw new Error("便條貼最多 50,000 字元。");
  const epoch = useApp.getState().workspace.epoch;
  const apply = (w: import("../types").Workspace) => {
    const a = w.annotations.find((a) => a.id === id);
    if (!a) throw new Error("標註已移除。");
    Object.assign(a, patch, { updatedAt: now() });
  };
  try {
    await mutate(apply, epoch);
  } catch (error) {
    const current = useApp.getState();
    if (
      current.saveError &&
      current.workspace.epoch === epoch &&
      current.workspace.annotations.some((a) => a.id === id)
    ) {
      const draft = structuredClone(current.unsavedDraft || current.workspace);
      apply(draft);
      useApp.setState({ workspace: draft, unsavedDraft: draft });
    }
    throw error;
  }
}

export async function deleteAnnotation(id: string) {
  await mutate((w) => {
    const a = w.annotations.find((a) => a.id === id);
    if (a?.status === "running") throw new Error("請先暫停生成，再刪除標註。");
    w.annotations = w.annotations.filter((a) => a.id !== id);
  }, useApp.getState().workspace.epoch);
}
