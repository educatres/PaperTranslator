import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TextLayer, type PDFDocumentProxy } from "pdfjs-dist";
import {
  ChevronLeft,
  ChevronRight,
  Hand,
  MousePointer2,
  Search,
  X,
  ZoomIn,
  ZoomOut,
  Maximize,
  RotateCw,
  MessageSquareText,
  LoaderCircle,
  BookOpen,
  FileUp,
  ArrowUpRight,
  Check,
  Languages,
  CircleAlert,
  Highlighter,
  StickyNote,
  NotebookPen,
  Sparkles,
} from "lucide-react";
import "pdfjs-dist/web/pdf_viewer.css";
import {
  NS,
  type PageLayout,
  type TranslationBlock,
  type Annotation,
  type AnnotationColor,
  type Quad,
} from "../types";
import { openPaper } from "../lib/pdf";
import { toast, useApp } from "../lib/storage";
import { projectQuad, unprojectPoint } from "../lib/geometry";
import { runAnnotation, validResult } from "../lib/tasks";
import { TranslationPopover } from "./TranslationPopover";
import {
  addAnnotation,
  annotationColors,
  annotationLabels,
  captureTextSelection,
  type TextSelection,
} from "../lib/annotations";
import { AnnotationsPanel } from "./AnnotationsPanel";

function PdfPage({
  pdf,
  index,
  width,
  rotation,
  layout,
  blocks,
  root,
  selected,
  query,
  showMarkers,
  activate,
  open,
  preview,
  leave,
  openAnnotation,
}: {
  pdf: PDFDocumentProxy;
  index: number;
  width: number;
  rotation: number;
  layout?: PageLayout;
  blocks: TranslationBlock[];
  root: HTMLElement | null;
  selected?: string;
  query: string;
  showMarkers: boolean;
  activate: (n: number) => void;
  open: (id: string) => void;
  preview: (id: string) => void;
  leave: () => void;
  openAnnotation: (id: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null),
    canvasRef = useRef<HTMLCanvasElement>(null),
    textRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false),
    [ready, setReady] = useState(false),
    [error, setError] = useState(""),
    [geometry, setGeometry] = useState<{
      height: number;
      transform: number[];
    }>();
  const w = useApp((s) => s.workspace);
  const angle = ((layout?.nativeRotation || 0) + rotation) % 360;
  const ratio = layout
    ? angle % 180
      ? layout.width / layout.height
      : layout.height / layout.width
    : Math.SQRT2;
  useEffect(() => {
    const el = ref.current!;
    const observer = new IntersectionObserver(
      (entries) => setVisible(entries[0].isIntersecting),
      { root, rootMargin: "700px 0px" },
    );
    const active = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) activate(index + 1);
      },
      { root, rootMargin: "-10% 0px -70% 0px" },
    );
    observer.observe(el);
    active.observe(el);
    return () => {
      observer.disconnect();
      active.disconnect();
    };
  }, [root, index, activate]);
  useEffect(() => {
    if (!visible) {
      setReady(false);
      return;
    }
    let cancelled = false,
      render: { cancel: () => void } | undefined,
      textLayer: TextLayer | undefined;
    setReady(false);
    setError("");
    void (async () => {
      const page = await pdf.getPage(index + 1);
      if (cancelled) return;
      const native = (page.rotate + rotation) % 360,
        base = page.getViewport({ scale: 1, rotation: native }),
        viewport = page.getViewport({
          scale: width / base.width,
          rotation: native,
        });
      setGeometry({
        height: viewport.height,
        transform: [...viewport.transform],
      });
      const el = ref.current!;
      el.style.setProperty("--scale-factor", String(viewport.scale));
      el.style.setProperty(
        "--total-scale-factor",
        String(viewport.scale * page.userUnit),
      );
      el.dataset.rotation = String(native);
      const canvas = canvasRef.current!,
        dpr = Math.min(devicePixelRatio || 1, 2);
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      const task = page.render({
        canvas,
        viewport,
        transform: [dpr, 0, 0, dpr, 0, 0],
      });
      render = task;
      const content = await page.getTextContent();
      if (cancelled) return;
      textRef.current!.replaceChildren();
      // Keep the PDF's Latin font fallback independent of the Traditional Chinese UI language.
      textRef.current!.lang = content.lang || "en";
      textLayer = new TextLayer({
        textContentSource: content,
        container: textRef.current!,
        viewport,
      });
      await Promise.all([task.promise, textLayer.render()]);
      if (!cancelled) setReady(true);
    })().catch((e) => {
      if (
        !cancelled &&
        e.name !== "RenderingCancelledException" &&
        e.name !== "AbortException"
      )
        setError("頁面無法顯示，請重新開啟文獻。");
    });
    return () => {
      cancelled = true;
      render?.cancel();
      textLayer?.cancel();
    };
  }, [pdf, index, width, rotation, visible]);
  const groups = useMemo(() => {
    if (!layout || !geometry) return [];
    const markers = blocks
      .filter((b) => b.eligibility !== "excluded")
      .map((b) => {
        const first = projectQuad(b.lines[0].quad, layout, geometry.transform),
          lines = b.lines.map((l) =>
            projectQuad(l.quad, layout, geometry.transform),
          );
        const right = Math.max(...lines.map((l) => l.left + l.width)),
          left = Math.min(...lines.map((l) => l.left));
        return {
          x: right + 14 < width - 8 ? right + 14 : Math.max(10, left - 14),
          y: first.top + first.height / 2,
          blocks: [b],
        };
      })
      .sort((a, b) => a.y - b.y);
    const groups: typeof markers = [];
    for (const m of markers) {
      const collision = groups.find(
        (g) => Math.abs(g.x - m.x) < 32 && Math.abs(g.y - m.y) < 42,
      );
      if (collision) collision.blocks.push(...m.blocks);
      else groups.push(m);
    }
    return groups;
  }, [blocks, layout, geometry, width]);
  return (
    <div
      ref={ref}
      className={`pdf-page ${ready ? "ready" : ""}`}
      data-page-index={index}
      data-viewport={geometry ? JSON.stringify(geometry.transform) : undefined}
      style={{ width, height: geometry?.height || width * ratio }}
    >
      {visible ? (
        <>
          <canvas ref={canvasRef} />
          <div ref={textRef} className="textLayer" />
          {!ready && !error && <LoaderCircle className="page-loading spin" />}
          {error && <p className="page-error">{error}</p>}
        </>
      ) : (
        <span className="page-placeholder">{index + 1}</span>
      )}
      {ready && layout && geometry && (
        <div className="annotation-layer">
          {w.annotations
            .filter((a) => a.documentId === layout.documentId)
            .flatMap((a) =>
              a.anchors
                .filter((anchor) => anchor.pageIndex === index)
                .flatMap((anchor) =>
                  anchor.quads.map((quad, i) => (
                    <div
                      key={`${a.id}-${i}`}
                      className={`manual-highlight annotation-${a.color}`}
                      data-highlight={a.id}
                      style={projectQuad(quad, layout, geometry.transform)}
                    />
                  )),
                ),
            )}
          {w.annotations
            .filter((a) => a.documentId === layout.documentId)
            .flatMap((a) =>
              a.anchors
                .filter((anchor) => anchor.pageIndex === index)
                .map((anchor) => {
                  const box = projectQuad(
                    anchor.quads[0],
                    layout,
                    geometry.transform,
                  );
                  return (
                    <button
                      key={a.id}
                      data-annotation-pin={a.id}
                      className={`user-annotation-pin annotation-${a.color}`}
                      aria-label={`${annotationLabels[a.kind]}，第 ${index + 1} 頁`}
                      style={{
                        left: Math.max(12, box.left - 14),
                        top: box.top + box.height / 2,
                      }}
                      onClick={() => openAnnotation(a.id)}
                    >
                      {a.kind === "highlight" ? (
                        <Highlighter size={12} />
                      ) : a.kind === "note" ? (
                        <StickyNote size={12} />
                      ) : a.kind === "translation" ? (
                        <Languages size={12} />
                      ) : (
                        <Sparkles size={12} />
                      )}
                    </button>
                  );
                }),
            )}
          {blocks
            .filter(
              (b) =>
                b.id === selected ||
                (query &&
                  b.normalizedText.toLowerCase().includes(query.toLowerCase())),
            )
            .flatMap((b) =>
              b.lines.map((l, i) => (
                <div
                  key={`${b.id}-${i}`}
                  className={`source-outline ${b.id === selected ? "focused" : "search-match"}`}
                  style={projectQuad(l.quad, layout, geometry.transform)}
                />
              )),
            )}
          {showMarkers &&
            groups.map((g, i) =>
              g.blocks.length === 1 ? (
                <button
                  data-marker={g.blocks[0].id}
                  key={g.blocks[0].id}
                  className={`translation-marker ${validResult(w, g.blocks[0]) ? "translated" : ""} ${selected === g.blocks[0].id ? "active" : ""}`}
                  style={{ left: g.x, top: g.y }}
                  aria-label={`段落 ${g.blocks[0].order + 1} 翻譯備註`}
                  onMouseEnter={() => preview(g.blocks[0].id)}
                  onMouseLeave={leave}
                  onFocus={() => preview(g.blocks[0].id)}
                  onBlur={leave}
                  onClick={() => open(g.blocks[0].id)}
                >
                  {validResult(w, g.blocks[0]) ? (
                    <Check size={12} />
                  ) : (
                    <MessageSquareText size={12} />
                  )}
                </button>
              ) : (
                <details
                  key={`group-${i}`}
                  className="marker-group"
                  style={{ left: g.x, top: g.y }}
                >
                  <summary aria-label={`${g.blocks.length} 個段落備註`}>
                    <MessageSquareText size={12} />
                    <b>{g.blocks.length}</b>
                  </summary>
                  <div>
                    {g.blocks.map((b) => (
                      <button
                        key={b.id}
                        data-marker={b.id}
                        onClick={() => open(b.id)}
                        onMouseEnter={() => preview(b.id)}
                        onMouseLeave={leave}
                      >
                        段落 {b.order + 1}
                        {validResult(w, b) && <Check size={12} />}
                      </button>
                    ))}
                  </div>
                </details>
              ),
            )}
        </div>
      )}
      <span className="page-number-label">
        {String(index + 1).padStart(2, "0")}
      </span>
    </div>
  );
}
interface View {
  page: number;
  zoom: number;
  rotation: number;
  mode: "select" | "pan";
}
function readView(id: string): View {
  try {
    const v = JSON.parse(sessionStorage.getItem(`${NS}.view.${id}`) || "{}");
    return {
      page: Number.isInteger(v.page) && v.page > 0 ? v.page : 1,
      zoom: v.zoom >= 0.4 && v.zoom <= 2.5 ? v.zoom : 1,
      rotation: [0, 90, 180, 270].includes(v.rotation) ? v.rotation : 0,
      mode: v.mode === "pan" ? "pan" : "select",
    };
  } catch {
    return { page: 1, zoom: 1, rotation: 0, mode: "select" };
  }
}
export function PdfViewer({
  onImport,
  onSample,
}: {
  onImport: () => void;
  onSample: () => void;
}) {
  const { workspace: w, activeId, fileRevision } = useApp(),
    paper = w.documents.find((d) => d.id === activeId);
  const [pdf, setPdf] = useState<PDFDocumentProxy>(),
    [error, setError] = useState(""),
    [view, setView] = useState<View>(() => readView(activeId || "")),
    [width, setWidth] = useState(900),
    [root, setRoot] = useState<HTMLDivElement | null>(null),
    [markers, setMarkers] = useState(true),
    [query, setQuery] = useState(""),
    [search, setSearch] = useState(false),
    [hit, setHit] = useState(0),
    [pageInput, setPageInput] = useState("1");
  const [pen, setPen] = useState(false),
    [color, setColor] = useState<AnnotationColor>("yellow"),
    [noteMode, setNoteMode] = useState(false),
    [notesOpen, setNotesOpen] = useState(false),
    [annotationId, setAnnotationId] = useState<string>(),
    [textSelection, setTextSelection] = useState<TextSelection>(),
    [adding, setAdding] = useState(false);
  const addingRef = useRef(false);
  const [selection, setSelection] = useState<{ id: string; pinned: boolean }>(),
    hoverTimer = useRef<ReturnType<typeof setTimeout>>(undefined),
    pan = useRef<
      { x: number; y: number; left: number; top: number } | undefined
    >(undefined);
  const selected = w.blocks.find((b) => b.id === selection?.id),
    blocks = w.blocks.filter((b) => b.documentId === activeId);
  function openAnnotation(id: string) {
    setAnnotationId(id);
    setNotesOpen(true);
    setSelection(undefined);
    setTextSelection(undefined);
  }
  async function createAnnotation(
    kind: Annotation["kind"],
    source = textSelection,
    chosenColor = color,
  ) {
    if (!source || addingRef.current) return;
    addingRef.current = true;
    setAdding(true);
    try {
      const id = await addAnnotation(source, kind, chosenColor);
      window.getSelection()?.removeAllRanges();
      setTextSelection(undefined);
      if (kind !== "highlight") openAnnotation(id);
      else toast("已保存螢光標記");
      if (kind === "translation" || kind === "summary") void runAnnotation(id);
    } catch (e) {
      toast((e as Error).message);
    } finally {
      addingRef.current = false;
      setAdding(false);
    }
  }
  useEffect(() => {
    if (!root || view.mode !== "select" || noteMode || !activeId) return;
    let timer: ReturnType<typeof setTimeout>;
    const capture = () => {
      clearTimeout(timer);
      timer = setTimeout(
        () => setTextSelection(captureTextSelection(root, w.pages, activeId)),
        100,
      );
    };
    document.addEventListener("selectionchange", capture);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("selectionchange", capture);
    };
  }, [root, w.pages, activeId, view.mode, noteMode]);
  useEffect(() => {
    setTextSelection(undefined);
    window.getSelection()?.removeAllRanges();
  }, [view.zoom, view.rotation, activeId]);
  const close = useCallback(() => {
    setSelection((current) => {
      if (current?.pinned)
        requestAnimationFrame(() =>
          document
            .querySelector<HTMLButtonElement>(`[data-marker="${current.id}"]`)
            ?.focus(),
        );
      return undefined;
    });
  }, []);
  useEffect(() => {
    setPdf(undefined);
    setError("");
    setSelection(undefined);
    setAnnotationId(undefined);
    setQuery("");
    setView(readView(activeId || ""));
    let cancelled = false;
    if (paper)
      void openPaper(paper)
        .then((p) => {
          if (!cancelled) setPdf(p);
        })
        .catch((e) => {
          if (!cancelled) setError(e.message);
        });
    return () => {
      cancelled = true;
    };
  }, [activeId, w.epoch, fileRevision]);
  useEffect(() => {
    if (!root) return;
    const resize = new ResizeObserver((es) =>
      setWidth(es[0].contentRect.width),
    );
    resize.observe(root);
    return () => resize.disconnect();
  }, [root]);
  useEffect(() => {
    setPageInput(String(view.page));
    try {
      if (activeId)
        sessionStorage.setItem(`${NS}.view.${activeId}`, JSON.stringify(view));
    } catch {
      /* Per-tab view is optional. */
    }
  }, [view, activeId]);
  const go = useCallback(
    (n: number) => {
      if (!paper) return;
      const page = Math.max(1, Math.min(paper.pageCount, n));
      root
        ?.querySelector(`[data-page-index="${page - 1}"]`)
        ?.scrollIntoView({ block: "start", behavior: "instant" });
      setView((v) => ({ ...v, page }));
    },
    [root, paper?.pageCount],
  );
  useEffect(() => {
    if (pdf) {
      const t = setTimeout(() => go(readView(activeId || "").page), 80);
      return () => clearTimeout(t);
    }
  }, [pdf, root]);
  const activate = useCallback(
    (page: number) => setView((v) => (v.page === page ? v : { ...v, page })),
    [],
  );
  const keep = () => {
    clearTimeout(hoverTimer.current);
  };
  const leave = () => {
    clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(
      () => setSelection((s) => (s?.pinned ? s : undefined)),
      250,
    );
  };
  const preview = (id: string) => {
    keep();
    setSelection((s) => (s?.pinned ? s : { id, pinned: false }));
  };
  const open = (id: string) => {
    keep();
    setSelection({ id, pinned: true });
  };
  const hits = query.trim()
    ? blocks.filter((b) =>
        b.normalizedText.toLowerCase().includes(query.toLowerCase().trim()),
      )
    : [];
  function jump(n: number) {
    if (!hits.length) return;
    const next = (n + hits.length) % hits.length;
    setHit(next);
    go(hits[next].pageIndex + 1);
  }
  useEffect(() => {
    setHit(0);
    if (hits[0]) go(hits[0].pageIndex + 1);
  }, [query]);
  useEffect(() => () => clearTimeout(hoverTimer.current), []);
  if (!paper)
    return (
      <section className="welcome">
        <div className="welcome-copy">
          <span className="eyebrow">READ SLOWLY. UNDERSTAND DEEPLY.</span>
          <h2>
            讀懂每一段，
            <br />
            <em>走近每個發現。</em>
          </h2>
          <p>
            保留論文原本的樣子，讓繁體中文譯文陪你閱讀。
            <br />
            從一段到全文，依自己的步調理解研究。
          </p>
          <div className="welcome-actions">
            <button className="primary-button" onClick={onImport}>
              <FileUp size={17} />
              匯入你的第一篇 PDF
            </button>
            <button className="text-button" onClick={onSample}>
              試讀範例文獻
              <ArrowUpRight size={15} />
            </button>
          </div>
          <small>也可以直接拖放 PDF · 資料保存在這台裝置</small>
        </div>
        <div className="reading-art" aria-hidden="true">
          <div className="art-paper">
            <span>THE ART OF UNDERSTANDING</span>
            <h3>
              A closer look,
              <br />a clearer thought.
            </h3>
            <div className="art-rule" />
            <div className="art-columns">
              <div>
                <i />
                <i />
                <i />
                <i />
                <i className="short" />
                <br />
                <i />
                <i />
                <i />
                <i />
                <i />
              </div>
              <div>
                <i />
                <i />
                <i />
                <i className="short" />
                <br />
                <i />
                <i />
                <i />
                <i />
                <i />
              </div>
            </div>
            <b>01</b>
          </div>
          <div className="art-note">
            <Languages size={17} />
            <span>每個想法，都值得讀懂。</span>
            <i>TRANSLATION, BY YOUR SIDE.</i>
          </div>
          <div className="art-seal">
            <BookOpen size={23} />
          </div>
        </div>
        <div className="welcome-steps">
          {[
            ["01", "帶入文獻", "PDF 留在本機，保留原始版面。"],
            ["02", "逐段理解", "點段旁圖示，按需翻譯與回查。"],
            ["03", "帶走研究", "保存譯文與摘要，隨時接續。"],
          ].map(([n, t, s]) => (
            <div key={n}>
              <b>{n}</b>
              <h3>{t}</h3>
              <p>{s}</p>
            </div>
          ))}
        </div>
      </section>
    );
  return (
    <section className="reader" aria-label="PDF 閱讀器">
      <div className="pdf-toolbar">
        <div className="tool-group">
          <button
            className={`icon-button ${view.mode === "select" ? "active" : ""}`}
            aria-label="選字模式"
            aria-pressed={view.mode === "select"}
            onClick={() => {
              setPen(false);
              setNoteMode(false);
              setView((v) => ({ ...v, mode: "select" }));
            }}
          >
            <MousePointer2 size={16} />
          </button>
          <button
            className={`icon-button ${view.mode === "pan" ? "active" : ""}`}
            aria-label="手掌模式"
            aria-pressed={view.mode === "pan"}
            onClick={() => {
              setPen(false);
              setNoteMode(false);
              setTextSelection(undefined);
              setView((v) => ({ ...v, mode: "pan" }));
            }}
          >
            <Hand size={16} />
          </button>
        </div>
        <i className="divider" />
        <button
          className={`icon-button ${pen ? "active" : ""}`}
          aria-label="螢光筆模式"
          aria-pressed={pen}
          title="選取文字後自動標記"
          onClick={() => {
            setPen(!pen);
            setNoteMode(false);
            setView((v) => ({ ...v, mode: "select" }));
          }}
        >
          <Highlighter size={16} />
        </button>
        <div className="highlighter-palette" aria-label="螢光筆顏色">
          {annotationColors.map((c) => (
            <button
              key={c.id}
              className={`color-dot annotation-${c.id}`}
              aria-label={`${c.name}螢光筆`}
              aria-pressed={color === c.id}
              onClick={() => {
                setColor(c.id);
                setPen(true);
                setNoteMode(false);
                setView((v) => ({ ...v, mode: "select" }));
              }}
            />
          ))}
        </div>
        <button
          className={`icon-button ${noteMode ? "active" : ""}`}
          aria-label="貼上便條貼"
          aria-pressed={noteMode}
          title="按下後點 PDF 頁面"
          onClick={() => {
            setNoteMode(!noteMode);
            setPen(false);
            setTextSelection(undefined);
            setView((v) => ({ ...v, mode: "select" }));
          }}
        >
          <StickyNote size={16} />
        </button>
        <button
          className={`icon-button ${notesOpen ? "active" : ""}`}
          aria-label="開啟我的標註"
          aria-pressed={notesOpen}
          onClick={() => setNotesOpen(!notesOpen)}
        >
          <NotebookPen size={16} />
        </button>
        <i className="divider" />
        <button
          className="icon-button"
          aria-label="縮小 PDF"
          onClick={() =>
            setView((v) => ({ ...v, zoom: Math.max(0.4, v.zoom - 0.15) }))
          }
        >
          <ZoomOut size={16} />
        </button>
        <span className="zoom-value">{Math.round(view.zoom * 100)}%</span>
        <button
          className="icon-button"
          aria-label="放大 PDF"
          onClick={() =>
            setView((v) => ({ ...v, zoom: Math.min(2.5, v.zoom + 0.15) }))
          }
        >
          <ZoomIn size={16} />
        </button>
        <button
          className="icon-button"
          aria-label="適合寬度"
          onClick={() => setView((v) => ({ ...v, zoom: 1 }))}
        >
          <Maximize size={16} />
        </button>
        <button
          className="icon-button"
          aria-label="旋轉 PDF"
          onClick={() =>
            setView((v) => ({ ...v, rotation: (v.rotation + 90) % 360 }))
          }
        >
          <RotateCw size={16} />
        </button>
        <i className="divider" />
        <button
          className={`icon-button ${search ? "active" : ""}`}
          aria-label="搜尋 PDF"
          onClick={() => setSearch(!search)}
        >
          <Search size={16} />
        </button>
        <button
          className={`icon-button ${markers ? "active" : ""}`}
          aria-label="顯示翻譯圖示"
          aria-pressed={markers}
          onClick={() => setMarkers(!markers)}
        >
          <MessageSquareText size={16} />
        </button>
        <span className="toolbar-spacer" />
        <div className="page-controls">
          <button
            className="icon-button"
            aria-label="上一頁"
            onClick={() => go(view.page - 1)}
            disabled={view.page <= 1}
          >
            <ChevronLeft size={16} />
          </button>
          <input
            aria-label="頁碼"
            inputMode="numeric"
            value={pageInput}
            onChange={(e) => setPageInput(e.target.value)}
            onBlur={() => go(Number(pageInput) || 1)}
            onKeyDown={(e) => {
              if (e.key === "Enter") go(Number(pageInput) || 1);
            }}
          />
          <span>/ {paper.pageCount}</span>
          <button
            className="icon-button"
            aria-label="下一頁"
            onClick={() => go(view.page + 1)}
            disabled={view.page >= paper.pageCount}
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
      {search && (
        <div className="pdf-search">
          <Search size={15} />
          <input
            autoFocus
            aria-label="搜尋文獻原文"
            placeholder="搜尋原文段落…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") jump(hit + (e.shiftKey ? -1 : 1));
            }}
          />
          <span>
            {query ? `${hits.length ? hit + 1 : 0} / ${hits.length}` : ""}
          </span>
          <button
            className="icon-button"
            aria-label="上一個搜尋結果"
            onClick={() => jump(hit - 1)}
          >
            <ChevronLeft size={16} />
          </button>
          <button
            className="icon-button"
            aria-label="下一個搜尋結果"
            onClick={() => jump(hit + 1)}
          >
            <ChevronRight size={16} />
          </button>
          <button
            className="icon-button"
            aria-label="關閉搜尋"
            onClick={() => {
              setSearch(false);
              setQuery("");
            }}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {w.pages
        .find((p) => p.documentId === activeId && p.pageIndex === view.page - 1)
        ?.warnings.map((w) => (
          <div className="ocr-notice" key={w}>
            <CircleAlert size={14} />
            {w}
          </div>
        ))}
      {noteMode && (
        <div className="annotation-hint">
          點一下 PDF 頁面放置便條貼。
          <button className="text-button" onClick={() => setNoteMode(false)}>
            取消
          </button>
        </div>
      )}
      <div className="reader-content">
        <div
          ref={setRoot}
          className={`pdf-scroll mode-${view.mode} ${noteMode ? "mode-note" : ""} ${pen ? "mode-highlight" : ""}`}
          onPointerDown={(e) => {
            if (
              noteMode &&
              e.button === 0 &&
              !(e.target as HTMLElement).closest("button,summary")
            ) {
              const page = (e.target as HTMLElement).closest<HTMLElement>(
                ".pdf-page.ready",
              );
              const layout = w.pages.find(
                (p) =>
                  p.documentId === activeId &&
                  p.pageIndex === Number(page?.dataset.pageIndex),
              );
              if (page?.dataset.viewport && layout && activeId) {
                e.preventDefault();
                const bounds = page.getBoundingClientRect();
                const p = unprojectPoint(
                  [e.clientX - bounds.left, e.clientY - bounds.top],
                  layout,
                  JSON.parse(page.dataset.viewport),
                );
                const quad: Quad = [
                  p,
                  [Math.min(1, p[0] + 0.015), p[1]],
                  [Math.min(1, p[0] + 0.015), Math.min(1, p[1] + 0.015)],
                  [p[0], Math.min(1, p[1] + 0.015)],
                ];
                setNoteMode(false);
                void createAnnotation("note", {
                  documentId: activeId,
                  quote: "",
                  anchors: [{ pageIndex: layout.pageIndex, quads: [quad] }],
                });
              }
              return;
            }
            if (
              view.mode === "pan" &&
              e.button === 0 &&
              !(e.target as HTMLElement).closest("button,summary")
            ) {
              pan.current = {
                x: e.clientX,
                y: e.clientY,
                left: e.currentTarget.scrollLeft,
                top: e.currentTarget.scrollTop,
              };
              e.currentTarget.setPointerCapture(e.pointerId);
              e.preventDefault();
            }
          }}
          onPointerMove={(e) => {
            if (pan.current) {
              e.currentTarget.scrollLeft =
                pan.current.left + pan.current.x - e.clientX;
              e.currentTarget.scrollTop =
                pan.current.top + pan.current.y - e.clientY;
            }
          }}
          onPointerUp={() => {
            pan.current = undefined;
            if (
              pen &&
              !noteMode &&
              view.mode === "select" &&
              root &&
              activeId
            ) {
              const source = captureTextSelection(root, w.pages, activeId);
              if (source) void createAnnotation("highlight", source);
            }
          }}
          onPointerCancel={() => {
            pan.current = undefined;
          }}
        >
          {error ? (
            <div className="missing-file">
              <FileUp size={32} />
              <h3>補回 PDF，接續閱讀</h3>
              <p>{error}</p>
              <button className="primary-button" onClick={onImport}>
                補回原始 PDF
              </button>
              <div className="text-results">
                {blocks.map((b) => (
                  <button key={b.id} onClick={() => open(b.id)}>
                    <b>
                      p. {b.pageIndex + 1} · 段落 {b.order + 1}
                    </b>
                    <p>{validResult(w, b)?.text || b.normalizedText}</p>
                  </button>
                ))}
              </div>
            </div>
          ) : pdf ? (
            Array.from({ length: pdf.numPages }, (_, index) => (
              <PdfPage
                key={`${paper.id}-${index}`}
                pdf={pdf}
                index={index}
                width={Math.max(160, Math.min(1040, width - 96) * view.zoom)}
                rotation={view.rotation}
                layout={w.pages.find(
                  (p) => p.documentId === activeId && p.pageIndex === index,
                )}
                blocks={blocks.filter((b) => b.pageIndex === index)}
                root={root}
                selected={selected?.id}
                query={query.trim()}
                showMarkers={markers}
                activate={activate}
                open={open}
                preview={preview}
                leave={leave}
                openAnnotation={openAnnotation}
              />
            ))
          ) : (
            <div className="loading-state">
              <LoaderCircle className="spin" />
              正在開啟文獻…
            </div>
          )}
        </div>
        {notesOpen && (
          <AnnotationsPanel
            documentId={paper.id}
            selectedId={annotationId}
            select={setAnnotationId}
            close={() => setNotesOpen(false)}
            locate={(a) => {
              go(a.anchors[0].pageIndex + 1);
              setAnnotationId(a.id);
              requestAnimationFrame(() =>
                root
                  ?.querySelector(`[data-annotation-pin="${a.id}"]`)
                  ?.scrollIntoView({ block: "center", inline: "nearest" }),
              );
            }}
          />
        )}
      </div>
      {textSelection && (
        <div
          className="selection-actions"
          role="toolbar"
          aria-label="選取文字操作"
          onPointerDown={(e) => e.preventDefault()}
        >
          <span className="selection-excerpt">
            {textSelection.quote.slice(0, 90)}
            {textSelection.quote.length > 90 ? "…" : ""}
          </span>
          <div className="selection-buttons">
            {annotationColors.map((c) => (
              <button
                disabled={adding}
                key={c.id}
                className={`color-dot annotation-${c.id}`}
                aria-label={`以${c.name}標記選取文字`}
                onClick={() =>
                  void createAnnotation("highlight", textSelection, c.id)
                }
              />
            ))}
            <button
              disabled={adding}
              onClick={() => void createAnnotation("note")}
            >
              <StickyNote size={14} />
              便條貼
            </button>
            <button
              disabled={adding}
              onClick={() => void createAnnotation("summary")}
            >
              <Sparkles size={14} />
              AI 摘要
            </button>
            <button
              disabled={adding}
              onClick={() => void createAnnotation("translation")}
            >
              <Languages size={14} />
              AI 翻譯
            </button>
            <button
              className="icon-button"
              aria-label="取消文字選取"
              onClick={() => {
                setTextSelection(undefined);
                window.getSelection()?.removeAllRanges();
              }}
            >
              <X size={15} />
            </button>
          </div>
        </div>
      )}
      {selected && selection && (
        <TranslationPopover
          key={selected.id}
          block={selected}
          pinned={selection.pinned}
          close={close}
          onPin={() => setSelection((s) => (s ? { ...s, pinned: true } : s))}
          onEnter={keep}
          onLeave={leave}
          locate={() => go(selected.pageIndex + 1)}
        />
      )}
    </section>
  );
}
