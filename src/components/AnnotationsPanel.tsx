import { useEffect, useRef, useState } from "react";
import {
  Copy,
  LocateFixed,
  Pause,
  Play,
  RefreshCw,
  StickyNote,
  Trash2,
  X,
} from "lucide-react";
import {
  annotationColors,
  annotationLabels,
  deleteAnnotation,
  editAnnotation,
} from "../lib/annotations";
import { pauseTask, runAnnotation } from "../lib/tasks";
import { providerName } from "../lib/providers";
import { toast, useApp } from "../lib/storage";
import type { Annotation } from "../types";

function NoteEditor({ annotation }: { annotation: Annotation }) {
  const [value, setValue] = useState(annotation.content),
    [status, setStatus] = useState("");
  const draft = useRef(value),
    saved = useRef(annotation.content),
    pending = useRef<string | undefined>(undefined),
    timer = useRef<ReturnType<typeof setTimeout>>(undefined),
    sequence = useRef(0);
  const save = async () => {
    clearTimeout(timer.current);
    const content = draft.current;
    if (
      content === pending.current ||
      (pending.current === undefined && content === saved.current)
    )
      return;
    const request = ++sequence.current;
    pending.current = content;
    setStatus("正在保存…");
    try {
      await editAnnotation(annotation.id, { content });
      saved.current = content;
      if (request === sequence.current) setStatus("已保存");
    } catch {
      if (request === sequence.current) setStatus("保存失敗，請保留分頁並重試");
    } finally {
      if (pending.current === content) pending.current = undefined;
    }
  };
  useEffect(() => {
    const flush = () => {
      void save();
    };
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      clearTimeout(timer.current);
      void save();
    };
  }, [annotation.id]);
  useEffect(() => {
    if (draft.current === saved.current && pending.current === undefined) {
      draft.current = annotation.content;
      saved.current = annotation.content;
      setValue(annotation.content);
    }
  }, [annotation.content]);
  return (
    <div className="note-editor">
      <textarea
        autoFocus
        aria-label="便條貼內容"
        maxLength={50000}
        placeholder="寫下想法、問題或閱讀筆記…"
        value={value}
        onChange={(e) => {
          const next = e.target.value;
          setValue(next);
          setStatus("正在保存…");
          draft.current = next;
          clearTimeout(timer.current);
          timer.current = setTimeout(() => void save(), 500);
        }}
        onBlur={() => void save()}
      />
      <div className="note-save">
        <span role="status">{status || "輸入後自動保存"}</span>
        <button className="text-button" onClick={() => void save()}>
          儲存便條
        </button>
      </div>
    </div>
  );
}

export function AnnotationsPanel({
  documentId,
  selectedId,
  select,
  close,
  locate,
}: {
  documentId: string;
  selectedId?: string;
  select: (id: string) => void;
  close: () => void;
  locate: (annotation: Annotation) => void;
}) {
  const w = useApp((s) => s.workspace),
    runningId = useApp((s) => s.runningId);
  const annotations = w.annotations.filter((a) => a.documentId === documentId);
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    panel.current
      ?.querySelector(`[data-annotation-card="${selectedId}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);
  return (
    <aside className="annotations-panel" ref={panel} aria-label="我的標註">
      <header>
        <span>
          <StickyNote size={16} />
          我的標註 <b>{annotations.length}</b>
        </span>
        <button
          className="icon-button"
          aria-label="關閉標註側欄"
          onClick={close}
        >
          <X size={17} />
        </button>
      </header>
      <div className="annotation-cards">
        {!annotations.length && (
          <p className="annotation-empty">
            選取 PDF
            文字來標記、翻譯或摘要。也可以按工具列的便條貼，再點頁面留下想法。
          </p>
        )}
        {annotations.map((a) => {
          const active = selectedId === a.id,
            result = a.results.at(-1),
            ai = a.kind === "summary" || a.kind === "translation";
          return (
            <article
              key={a.id}
              data-annotation-card={a.id}
              className={`annotation-card annotation-${a.color} ${active ? "selected" : ""}`}
            >
              <button
                className="annotation-card-heading"
                onClick={() => select(a.id)}
                aria-expanded={active}
              >
                <strong>{annotationLabels[a.kind]}</strong>
                <span>
                  p.{" "}
                  {a.anchors.map((anchor) => anchor.pageIndex + 1).join(", ")}
                </span>
              </button>
              {a.quote && (
                <blockquote className={active ? "" : "collapsed"}>
                  {a.quote}
                </blockquote>
              )}
              {a.kind === "note" &&
                (active ? (
                  <NoteEditor key={a.id} annotation={a} />
                ) : (
                  <p className="annotation-text">
                    {a.content || "點擊卡片輸入便條…"}
                  </p>
                ))}
              {result && <div className="annotation-result">{result.text}</div>}
              {ai && (
                <div className="annotation-generation">
                  {a.status === "running" ? (
                    <span>
                      正在{a.kind === "translation" ? "翻譯" : "摘要"}選取原文…
                    </span>
                  ) : a.error ? (
                    <p className="error">{a.error}</p>
                  ) : (
                    !result && <p>僅傳送選取原文，使用目前 AI 設定。</p>
                  )}
                  {result && (
                    <small>
                      {providerName(result.provider)} · {result.model}
                      <br />
                      {new Date(result.createdAt).toLocaleString(
                        "zh-TW",
                      )} · {a.results.length} 個保存版本
                    </small>
                  )}
                  {active && a.results.length > 1 && (
                    <details>
                      <summary>歷史版本</summary>
                      {a.results.slice(0, -1).map((r, i) => (
                        <div className="annotation-history" key={i}>
                          <small>
                            {r.model} ·{" "}
                            {new Date(r.createdAt).toLocaleString("zh-TW")}
                          </small>
                          <p>{r.text}</p>
                        </div>
                      ))}
                    </details>
                  )}
                </div>
              )}
              {active && (
                <div className="annotation-colors" aria-label="變更標註顏色">
                  {annotationColors.map((c) => (
                    <button
                      key={c.id}
                      className={`color-dot annotation-${c.id}`}
                      aria-label={`標註顏色：${c.name}`}
                      aria-pressed={a.color === c.id}
                      onClick={() =>
                        void editAnnotation(a.id, { color: c.id }).catch((e) =>
                          toast(e.message),
                        )
                      }
                    />
                  ))}
                </div>
              )}
              <footer>
                <button
                  className="icon-button"
                  aria-label="定位標註原文"
                  onClick={() => locate(a)}
                >
                  <LocateFixed size={14} />
                </button>
                {(result || a.content) && (
                  <button
                    className="icon-button"
                    aria-label="複製標註文字"
                    onClick={() =>
                      void navigator.clipboard
                        .writeText(result?.text || a.content)
                        .then(() => toast("已複製標註"))
                        .catch(() => toast("請選取卡片文字複製。"))
                    }
                  >
                    <Copy size={14} />
                  </button>
                )}
                <button
                  className="icon-button"
                  aria-label="刪除標註"
                  disabled={a.status === "running"}
                  onClick={() => {
                    if (confirm("刪除這則標註？"))
                      void deleteAnnotation(a.id).catch((e) =>
                        toast(e.message),
                      );
                  }}
                >
                  <Trash2 size={14} />
                </button>
                {ai &&
                  (a.status === "running" ? (
                    <button
                      className="text-button"
                      disabled={runningId !== `annotation:${a.id}`}
                      onClick={pauseTask}
                    >
                      <Pause size={13} />
                      暫停
                    </button>
                  ) : (
                    <button
                      className="small-button"
                      disabled={!!runningId}
                      onClick={() => void runAnnotation(a.id)}
                    >
                      {result ? <RefreshCw size={13} /> : <Play size={13} />}
                      {result
                        ? "重新生成"
                        : a.status === "idle"
                          ? "開始生成"
                          : "重試生成"}
                    </button>
                  ))}
              </footer>
            </article>
          );
        })}
      </div>
    </aside>
  );
}
