import { useEffect, useLayoutEffect, useRef } from "react";
import { Copy, Languages, LocateFixed, RefreshCw, X } from "lucide-react";
import { currentConfig, makeJob, runJob, validResult } from "../lib/tasks";
import { providerName } from "../lib/providers";
import { toast, useApp } from "../lib/storage";
import type { TranslationBlock } from "../types";
export function TranslationPopover({
  block,
  pinned,
  close,
  onPin,
  onEnter,
  onLeave,
  locate,
}: {
  block: TranslationBlock;
  pinned: boolean;
  close: () => void;
  onPin: () => void;
  onEnter: () => void;
  onLeave: () => void;
  locate: () => void;
}) {
  const w = useApp((s) => s.workspace),
    runningId = useApp((s) => s.runningId),
    result = validResult(w, block),
    ref = useRef<HTMLElement>(null);
  const job = w.jobs.findLast((j) => j.blockIds.includes(block.id)),
    parts = job?.parts.filter((p) => p.blockId === block.id) || [];
  const running = job?.status === "running",
    partial = !result && parts.some((p) => p.result),
    resumable =
      job &&
      ["paused", "partial", "failed"].includes(job.status) &&
      job.blockIds.length === 1,
    config = resumable ? job.config : currentConfig();
  useLayoutEffect(() => {
    const panel = ref.current!,
      reader = panel.closest<HTMLElement>(".reader");
    if (!reader) return;
    let frame = 0;
    const place = () => {
      if (matchMedia("(max-width: 700px)").matches) {
        panel.style.removeProperty("left");
        panel.style.removeProperty("right");
        panel.style.removeProperty("top");
        return;
      }
      const marker = reader.querySelector<HTMLElement>(
        `[data-marker="${block.id}"]`,
      );
      if (!marker?.getClientRects().length) return;
      const bounds = reader.getBoundingClientRect(),
        anchor = marker.getBoundingClientRect();
      const width = panel.offsetWidth,
        height = panel.offsetHeight,
        gap = 12,
        margin = 8,
        top = 58;
      const x = anchor.left - bounds.left,
        y = anchor.top - bounds.top;
      const clampX = (value: number) =>
        Math.max(margin, Math.min(value, bounds.width - width - margin));
      const clampY = (value: number) =>
        Math.max(top, Math.min(value, bounds.height - height - margin));
      const candidates = [
        { left: x + anchor.width + gap, top: clampY(y) },
        { left: x - width - gap, top: clampY(y) },
        { left: clampX(x), top: y + anchor.height + gap },
        { left: clampX(x), top: y - height - gap },
      ];
      const target = candidates.find(
        (p) =>
          p.left >= margin &&
          p.top >= top &&
          p.left + width <= bounds.width - margin &&
          p.top + height <= bounds.height - margin,
      ) || {
        left: clampX(
          x > bounds.width / 2 ? x - width - gap : x + anchor.width + gap,
        ),
        top: clampY(y),
      };
      panel.style.left = `${target.left}px`;
      panel.style.top = `${target.top}px`;
      panel.style.right = "auto";
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(place);
    };
    place();
    const resize = new ResizeObserver(schedule);
    resize.observe(reader);
    resize.observe(panel);
    const changes = new MutationObserver(schedule);
    const pages = reader.querySelector(".pdf-scroll");
    if (pages) changes.observe(pages, { childList: true, subtree: true });
    reader.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      changes.disconnect();
      reader.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
    };
  }, [block.id]);
  useEffect(() => {
    if (!pinned) return;
    const listener = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", listener);
    const outside = (e: PointerEvent) => {
      if (
        ref.current &&
        !ref.current.contains(e.target as Node) &&
        !(e.target as HTMLElement).closest("[data-marker]")
      )
        close();
    };
    document.addEventListener("pointerdown", outside);
    return () => {
      window.removeEventListener("keydown", listener);
      document.removeEventListener("pointerdown", outside);
    };
  }, [pinned, close]);
  async function translate() {
    if (block.eligibility === "excluded") {
      toast("此內容已排除自動翻譯。");
      return;
    }
    if (
      block.eligibility === "review" &&
      !confirm("此片段的擷取順序待檢查。確認按畫面原文傳送並單獨翻譯？")
    )
      return;
    if (
      result &&
      !confirm(
        "重新翻譯會再次產生供應商用量。舊譯文會保留至新版本成功。是否繼續？",
      )
    )
      return;
    onPin();
    await runJob(
      resumable ? job : makeJob("translation", block.documentId, [block.id]),
      !!resumable,
    );
  }
  return (
    <aside
      ref={ref}
      className={`translation-popover ${pinned ? "pinned" : "preview"}`}
      role={pinned ? "dialog" : "region"}
      aria-label={pinned ? "段落翻譯備註" : "譯文預覽"}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      <header>
        <span>
          <Languages size={15} />
          段落 {block.order + 1}
          <b>
            p. {block.pageIndex + 1} ·{" "}
            {block.columnId === "left"
              ? "左欄"
              : block.columnId === "right"
                ? "右欄"
                : "單欄"}
          </b>
        </span>
        <button
          className="icon-button"
          onClick={close}
          aria-label="關閉翻譯備註"
        >
          <X size={16} />
        </button>
      </header>
      <div className="popover-content">
        <span className="eyebrow">繁體中文 TRANSLATION</span>
        {result ? (
          <div className="translated-text">{result.text}</div>
        ) : (
          <p className="empty-translation">
            {running
              ? "正在翻譯這個段落…"
              : partial
                ? "尚未完成，已保存部分譯文。"
                : "讀到這裡，讓意思更清楚。"}
          </p>
        )}
        {!result && partial && (
          <div className="translated-text">
            {parts
              .filter((p) => p.result)
              .map((p) => p.result!.text)
              .join("\n")}
          </div>
        )}
        {block.boundary && (
          <div className="boundary-label">
            頁／欄邊界片段 · 不補寫缺少的上下文
          </div>
        )}
        {result?.warnings.map((s) => (
          <p className="warning" key={s}>
            {s}
          </p>
        ))}
        {block.warnings.map((s) => (
          <p className="warning" key={s}>
            {s}
          </p>
        ))}
        {job?.error && !running && <p className="error">{job.error}</p>}
        <details open={!result}>
          <summary>
            原文 · {block.normalizedText.length.toLocaleString()} 字元
          </summary>
          <div className="original-text">{block.rawText}</div>
        </details>
        {result && (
          <details>
            <summary>生成資訊 · {providerName(result.provider)}</summary>
            <small>
              {result.model} · {result.reasoningEffort || "模型預設"}
              <br />
              {new Date(result.createdAt).toLocaleString("zh-TW")}
              {result.usage !== undefined && ` · ${result.usage} tokens`}
            </small>
          </details>
        )}
        <p className="field-help">
          {providerName(config.provider)} · {config.model || "尚未選擇模型"}
          。翻譯只會傳送這個段落的原文。
        </p>
      </div>
      <footer>
        <button
          className="text-button"
          onClick={() => {
            locate();
            onPin();
          }}
        >
          <LocateFixed size={14} />
          定位原文
        </button>
        {result && (
          <button
            className="text-button"
            onClick={() =>
              void navigator.clipboard
                .writeText(result.text)
                .then(() => toast("已複製譯文"))
                .catch(() => toast("無法存取剪貼簿，可選取譯文複製。"))
            }
          >
            <Copy size={14} />
            複製
          </button>
        )}
        <button
          className="small-button"
          disabled={running || !!runningId || block.eligibility === "excluded"}
          onClick={() => void translate()}
        >
          {result ? <RefreshCw size={13} /> : <Languages size={13} />}{" "}
          {result ? "重新翻譯" : partial ? "接續此段" : "翻譯此段"}
        </button>
      </footer>
    </aside>
  );
}
