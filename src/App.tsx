import { Component, useEffect, useRef, useState, type ReactNode } from "react";
import {
  BookOpen,
  Check,
  ShieldCheck,
  KeyRound,
  Download,
  Upload,
  Languages,
  Sparkles,
  FilePlus2,
  PanelLeft,
  FileText,
  Plus,
  X,
  Trash2,
  FolderOpen,
  FileArchive,
  Braces,
  NotebookPen,
  ArrowUpRight,
  Pause,
  Play,
  LoaderCircle,
  CircleHelp,
  HardDrive,
  WifiOff,
  Copy,
  ChevronRight,
} from "lucide-react";
import { PdfViewer } from "./components/PdfViewer";
import { Settings } from "./components/Settings";
import { Modal } from "./components/Modal";
import {
  activate,
  initialize,
  mutate,
  removeDocument,
  replaceWorkspace,
  toast,
  useApp,
} from "./lib/storage";
import { importPdf } from "./lib/pdf";
import {
  currentConfig,
  makeJob,
  pauseTask,
  runJob,
  splitParts,
  validResult,
  chunkDocument,
} from "./lib/tasks";
import {
  clearAllKeys,
  hasKey,
  providerName,
  useCredentials,
} from "./lib/providers";
import {
  download,
  exportJSON,
  exportMarkdown,
  exportPack,
  readImport,
  type ImportData,
} from "./lib/transfer";
import { emptyWorkspace, type Job } from "./types";

class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: boolean }
> {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  render() {
    return this.state.error ? (
      <main className="fatal">
        <BookOpen size={40} />
        <h1>顯示遇到問題</h1>
        <p>已保存的本機研究仍在瀏覽器中，請重新整理。</p>
        <button className="primary-button" onClick={() => location.reload()}>
          重新整理
        </button>
      </main>
    ) : (
      this.props.children
    );
  }
}
function ExportDialog({ close }: { close: () => void }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function action(type: "pack" | "json" | "markdown") {
    setBusy(true);
    setError("");
    try {
      if (type === "pack")
        download(
          await exportPack(),
          `${useApp.getState().workspace.title}.researchpack`,
        );
      else if (type === "json") await exportJSON();
      else await exportMarkdown();
      close();
      toast("研究已匯出");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="帶走你的研究"
      description="把讀過的、理解的，妥善保存。"
      close={close}
    >
      <div className="export-options">
        {[
          [
            "pack",
            FileArchive,
            "完整研究封裝",
            "原始 PDF、段落位置、譯文、摘要與進度。",
            ".researchpack · 可完整還原",
          ],
          [
            "markdown",
            NotebookPen,
            "Markdown 中英對照",
            "依文獻與頁碼整理原文、譯文及摘要。",
            ".md · 適合閱讀與分享",
          ],
          [
            "json",
            Braces,
            "JSON 研究資料",
            "保存文字、位置與任務，不含原始 PDF。",
            ".json · 可匯入後補回 PDF",
          ],
        ].map(([type, Icon, title, description, foot]) => {
          const Glyph = Icon as typeof FileArchive;
          return (
            <button
              key={String(type)}
              disabled={busy}
              onClick={() => void action(type as "pack" | "json" | "markdown")}
            >
              <span className="export-icon">
                <Glyph size={25} />
              </span>
              <div>
                <strong>
                  {title as string}
                  {type === "pack" && <b className="badge">建議備份</b>}
                </strong>
                <p>{description as string}</p>
                <small>{foot as string}</small>
              </div>
              <ArrowUpRight size={17} />
            </button>
          );
        })}
      </div>
      {error && <div className="error-box">{error}</div>}
      <p className="modal-footnote">
        <ShieldCheck size={14} />
        {busy ? "正在建立一致的研究快照…" : "所有匯出檔都不含 API 金鑰。"}
      </p>
    </Modal>
  );
}
function ConfirmTask({
  kind,
  close,
  onStarted,
}: {
  kind: Job["kind"];
  close: () => void;
  onStarted: () => void;
}) {
  const { workspace: w, activeId } = useApp(),
    paper = w.documents.find((d) => d.id === activeId)!,
    config = currentConfig();
  const blocks = w.blocks.filter((b) => b.documentId === activeId),
    targets = blocks.filter(
      (b) => b.eligibility === "ready" && !validResult(w, b),
    ),
    parts = targets.flatMap((b) => splitParts(b));
  const pages = w.pages
      .filter((p) => p.documentId === activeId)
      .sort((a, b) => a.pageIndex - b.pageIndex),
    chunks = chunkDocument(pages);
  const count = kind === "translation" ? targets.length : chunks.length,
    chars =
      kind === "translation"
        ? targets.reduce((n, b) => n + b.normalizedText.length, 0)
        : pages.reduce((n, p) => n + p.text.length, 0);
  const job = () =>
    makeJob(
      kind,
      paper.id,
      kind === "translation" ? targets.map((b) => b.id) : [],
      config,
    );
  return (
    <Modal
      title={kind === "translation" ? "全文逐段翻譯" : "生成全文摘要"}
      description="確認這次的閱讀範圍與 AI 設定。"
      close={close}
    >
      <div className="task-confirm">
        <div className="confirm-document">
          <FileText size={24} />
          <div>
            <strong>{paper.name}</strong>
            <p>
              {paper.pageCount} 頁 ·{" "}
              {kind === "translation"
                ? "只處理尚未完成的可翻譯段落"
                : "依版面閱讀順序擷取的原文"}
            </p>
          </div>
        </div>
        <div className="confirm-stats">
          <div>
            <strong>{count}</strong>
            <span>{kind === "translation" ? "目標段落" : "原文分塊"}</span>
          </div>
          <div>
            <strong>{chars.toLocaleString()}</strong>
            <span>原文字元</span>
          </div>
          <div>
            <strong>
              {kind === "translation"
                ? parts.length
                : `至少 ${chunks.length + 1}`}
            </strong>
            <span>預估生成請求</span>
          </div>
        </div>
        <div className="scope-breakdown">
          <span>
            已完成譯文 <b>{blocks.filter((b) => validResult(w, b)).length}</b>
          </span>
          <span>
            待檢查{" "}
            <b>{blocks.filter((b) => b.eligibility === "review").length}</b>
          </span>
          <span>
            已排除{" "}
            <b>{blocks.filter((b) => b.eligibility === "excluded").length}</b>
          </span>
          <span>
            需要 OCR／辨識失敗{" "}
            <b>{pages.filter((p) => p.warnings.length).length} 頁</b>
          </span>
        </div>
        {blocks.some((b) => b.eligibility !== "ready") && (
          <details className="scope-details">
            <summary>查看待檢查與排除內容</summary>
            {blocks
              .filter((b) => b.eligibility !== "ready")
              .map((b) => (
                <p key={b.id}>
                  <b>
                    p. {b.pageIndex + 1} ·{" "}
                    {b.eligibility === "review" ? "待檢查" : "已排除"}
                  </b>
                  <span>{b.normalizedText.slice(0, 160)}</span>
                  <small>{b.warnings.join("；")}</small>
                </p>
              ))}
          </details>
        )}
        <div className="config-summary">
          <b>{providerName(config.provider)}</b>
          <code>{config.model || "尚未選擇模型"}</code>
          <span>推理：{config.reasoningEffort || "模型預設"}</span>
        </div>
        <div className="privacy-note">
          <ShieldCheck size={20} />
          <p>
            {kind === "translation"
              ? "每次只傳送一個段落或其內部子片段，不合併跨頁、跨欄內容。待檢查與排除內容不會自動送出。"
              : "傳送原文分塊進行摘要，再分層整合。圖表、公式與未辨識內容可能不完整。"}
            原始 PDF 留在本機。字元數不是 token 數；實際費用以供應商帳單為準。
          </p>
        </div>
        {!hasKey(config.provider) && (
          <p className="warning">請先在 AI 設定加入目前供應商的金鑰。</p>
        )}
        <div className="dialog-actions">
          <button className="secondary-button" onClick={close}>
            稍後再說
          </button>
          <button
            className="primary-button"
            disabled={
              !count ||
              !hasKey(config.provider) ||
              !config.model ||
              paper.status === "indexing"
            }
            onClick={() => {
              const task = job();
              close();
              onStarted();
              void runJob(task);
            }}
          >
            {kind === "translation" ? (
              <Languages size={16} />
            ) : (
              <Sparkles size={16} />
            )}
            確認並開始{kind === "translation" ? "翻譯" : "摘要"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
function SummaryPanel({
  close,
  onGenerate,
}: {
  close: () => void;
  onGenerate: () => void;
}) {
  const { workspace: w, activeId } = useApp(),
    paper = w.documents.find((d) => d.id === activeId),
    versions = w.summaries.filter((s) => s.documentId === activeId),
    [chosen, setChosen] = useState("");
  const result =
      versions.find((s) => s.id === (chosen || paper?.currentSummaryId)) ||
      versions.at(-1),
    job = w.jobs.findLast(
      (j) => j.documentId === activeId && j.kind === "summary",
    );
  return (
    <aside className="summary-panel">
      <header>
        <span>
          <Sparkles size={16} />
          全文摘要
        </span>
        <button
          className="icon-button"
          onClick={close}
          aria-label="關閉全文摘要"
        >
          <X size={17} />
        </button>
      </header>
      <div className="summary-body">
        {result ? (
          <>
            <div className="eyebrow">A WIDER PERSPECTIVE</div>
            <h2>從細節，回望全貌。</h2>
            {versions.length > 1 && (
              <select
                aria-label="摘要版本"
                value={result.id}
                onChange={(e) => setChosen(e.target.value)}
              >
                {versions.map((s, i) => (
                  <option key={s.id} value={s.id}>
                    版本 {i + 1} ·{" "}
                    {new Date(s.createdAt).toLocaleString("zh-TW")}
                  </option>
                ))}
              </select>
            )}
            <div className="summary-text">{result.text}</div>
            <div className="source-pages">
              來源分塊
              {result.sourcePages.map(([a, b], i) => (
                <span key={i}>
                  p. {a}
                  {a !== b ? `–${b}` : ""}
                </span>
              ))}
            </div>
            <p className="field-help">
              {providerName(result.provider)} · {result.model}
              <br />
              {new Date(result.createdAt).toLocaleString("zh-TW")}
              <br />
              頁碼代表來源分塊範圍，並非經驗證的逐句引用；圖表與公式可能不完整。
            </p>
          </>
        ) : (
          <div className="summary-empty">
            <span>
              <Sparkles size={27} />
            </span>
            <h2>先讀細節，也看全貌。</h2>
            <p>
              整理背景、方法、主要結果與限制，
              <br />
              帶著頁碼回到原文確認。
            </p>
            {job && (
              <p className="field-help">
                已保存 {job.chunks.filter((c) => c.result).length}／
                {job.chunks.length} 個原文分塊
              </p>
            )}
          </div>
        )}
        {job?.error && <div className="error-box">{job.error}</div>}
        {job && job.status !== "complete" && job.status !== "running" && (
          <button
            className="secondary-button"
            onClick={() => void runJob(job, true)}
          >
            <Play size={14} />
            接續摘要 · {job.config.model}
          </button>
        )}
      </div>
      <footer>
        {result && (
          <button
            className="secondary-button"
            onClick={() =>
              void navigator.clipboard
                .writeText(result.text)
                .then(() => toast("已複製全文摘要"))
                .catch(() => toast("請選取摘要文字複製。"))
            }
          >
            <Copy size={14} />
            複製
          </button>
        )}
        <button
          className="primary-button"
          disabled={!paper || paper.status === "indexing"}
          onClick={onGenerate}
        >
          <Sparkles size={14} />
          {result ? "重新生成" : "生成摘要"}
        </button>
      </footer>
    </aside>
  );
}
function Help({ close }: { close: () => void }) {
  return (
    <Modal
      title="慢慢讀，讓理解留下來。"
      description="PaperTranslator 使用指南"
      close={close}
    >
      <div className="help-content">
        {[
          [
            "01",
            "帶入文獻",
            "匯入或拖放 PDF。原始檔與段落位置保存在目前瀏覽器。掃描 PDF 需要另行 OCR，這裡不會上傳原始檔或圖片。",
          ],
          [
            "02",
            "依自己的步調翻譯",
            "將滑鼠移到段旁圖示可預覽既有譯文，點擊可固定展開。只有按「翻譯此段」或確認全文任務才會呼叫 AI。跨頁、跨欄段落各自翻譯。",
          ],
          [
            "03",
            "隨時暫停，隨時回來",
            "長段落會分批處理並保存成功結果。暫停或重開後，輸入金鑰並按「接續」即可。多視窗共用任務鎖，同一時間只執行一個翻譯或摘要任務。",
          ],
          [
            "04",
            "看全貌，也回查原文",
            "全文摘要使用英文原文，包含研究背景、方法、發現與限制。頁碼是來源分塊範圍，請回查原文與數據。",
          ],
          [
            "05",
            "把研究帶走",
            "完整 .researchpack 包含 PDF。JSON 只含文字與位置，還原後需補回相同 PDF。匯入會先驗證並預覽，再由你確認取代目前研究。",
          ],
          [
            "06",
            "安心保存",
            "資料只留在本機；清除瀏覽器網站資料會刪除研究，請定期備份。API 金鑰只在目前分頁記憶體，重新整理即清除。首次完整快取後可離線閱讀已保存內容。",
          ],
        ].map(([n, t, p]) => (
          <section key={n}>
            <b>{n}</b>
            <div>
              <h3>{t}</h3>
              <p>{p}</p>
            </div>
          </section>
        ))}
        <p className="field-help">
          Ctrl / ⌘ + O 匯入 PDF · Esc 關閉對話框或翻譯備註
        </p>
      </div>
    </Modal>
  );
}

function AppContent() {
  const state = useApp(),
    {
      workspace: w,
      ready,
      activeId,
      preferences,
      runningId,
      busy,
      notice,
      saveError,
      settingsOpen,
    } = state;
  useCredentials();
  const [library, setLibrary] = useState(
      () => matchMedia("(min-width:701px)").matches,
    ),
    [summary, setSummary] = useState(false),
    [exportOpen, setExportOpen] = useState(false),
    [help, setHelp] = useState(false),
    [task, setTask] = useState<Job["kind"]>(),
    [incoming, setIncoming] = useState<ImportData>(),
    [online, setOnline] = useState(navigator.onLine),
    [startup, setStartup] = useState("");
  const fileRef = useRef<HTMLInputElement>(null),
    restoreRef = useRef<HTMLInputElement>(null),
    fileBusy = useRef(false),
    [dragging, setDragging] = useState(false),
    dragDepth = useRef(0);
  const paper = w.documents.find((d) => d.id === activeId),
    blocks = w.blocks.filter((b) => b.documentId === activeId),
    done = blocks.filter((b) => validResult(w, b)).length;
  const running =
      w.jobs.find((j) => j.id === runningId) ||
      w.jobs.find((j) => j.status === "running"),
    last = w.jobs.findLast(
      (j) => j.documentId === activeId && j.kind === "translation",
    );
  useEffect(() => {
    void initialize().catch(() =>
      setStartup(
        "無法開啟本機資料庫，請確認瀏覽器允許網站儲存資料後重新整理。",
      ),
    );
  }, []);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "o") {
        e.preventDefault();
        fileRef.current?.click();
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => useApp.setState({ notice: "" }), 7000);
    return () => clearTimeout(t);
  }, [notice]);
  async function handleFiles(files: File[]) {
    if (fileBusy.current) return;
    fileBusy.current = true;
    useApp.setState({ busy: "正在讀取 PDF…" });
    try {
      for (const file of files)
        await importPdf(file, (busy) => useApp.setState({ busy }));
    } catch (e) {
      toast((e as Error).message);
    } finally {
      fileBusy.current = false;
      useApp.setState({ busy: "" });
      if (fileRef.current) fileRef.current.value = "";
    }
  }
  async function sample() {
    try {
      const r = await fetch(`${import.meta.env.BASE_URL}sample.pdf`);
      if (!r.ok) throw new Error("範例尚未快取，請連線後再試。");
      await handleFiles([
        new File([await r.blob()], "A closer look — 閱讀範例.pdf", {
          type: "application/pdf",
        }),
      ]);
    } catch (e) {
      toast((e as Error).message);
    }
  }
  async function restore(file: File) {
    if (busy) return;
    useApp.setState({ busy: "正在驗證研究封裝…" });
    try {
      setIncoming(await readImport(file));
    } catch {
      toast(
        "匯入失敗：格式、版本、大小、路徑、校驗碼或關聯資料無效。PaperReader 封裝尚不支援遷移，原有研究未變更。",
      );
    } finally {
      useApp.setState({ busy: "" });
      if (restoreRef.current) restoreRef.current.value = "";
    }
  }
  if (!ready)
    return (
      <main className="fatal">
        <BookOpen size={37} />
        <h1>PaperTranslator</h1>
        <p>{startup || "正在打開你的閱讀空間…"}</p>
        {startup && (
          <button className="primary-button" onClick={() => location.reload()}>
            重新整理
          </button>
        )}
      </main>
    );
  return (
    <div
      className={`app-shell ${dragging ? "dragging" : ""}`}
      onDragEnter={(e) => {
        e.preventDefault();
        if (e.dataTransfer.types.includes("Files")) {
          dragDepth.current++;
          setDragging(true);
        }
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={(e) => {
        e.preventDefault();
        if (--dragDepth.current <= 0) {
          dragDepth.current = 0;
          setDragging(false);
        }
      }}
      onDrop={(e) => {
        e.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        if (e.dataTransfer.files.length)
          void handleFiles([...e.dataTransfer.files]);
      }}
    >
      <header className="app-header">
        <a
          className="brand"
          href={import.meta.env.BASE_URL}
          onClick={(e) => e.preventDefault()}
        >
          <span className="brand-symbol">
            <BookOpen size={23} />
          </span>
          <div>
            <h1>
              PaperTranslator<span className="version-tag">1.0</span>
            </h1>
            <span className="brand-tagline">
              A LITTLE CLOSER TO UNDERSTANDING
            </span>
          </div>
        </a>
        <div className="header-project">
          <span>YOUR READING SPACE</span>
          <input
            aria-label="研究名稱"
            value={w.title}
            maxLength={200}
            onChange={(e) => {
              const title = e.target.value;
              if (title.trim())
                void mutate((w) => {
                  w.title = title;
                }).catch(() => {});
            }}
          />
        </div>
        <nav className="header-actions">
          <button
            className="secondary-button"
            aria-label="匯入研究"
            disabled={!!busy}
            onClick={() => restoreRef.current?.click()}
          >
            <Upload size={15} />
            <span>匯入研究</span>
          </button>
          <button
            className="secondary-button"
            aria-label="匯出研究"
            onClick={() => setExportOpen(true)}
          >
            <Download size={15} />
            <span>匯出研究</span>
          </button>
          <button
            className="ai-settings-button"
            aria-label={hasKey(preferences.provider) ? "AI 已連接" : "AI 設定"}
            onClick={() => useApp.setState({ settingsOpen: true })}
          >
            <KeyRound size={15} />
            <span>
              {hasKey(preferences.provider) ? "AI 已連接" : "AI 設定"}
            </span>
            {hasKey(preferences.provider) && <i />}
          </button>
          <button
            className="icon-button"
            aria-label="使用指南"
            onClick={() => setHelp(true)}
          >
            <CircleHelp size={18} />
          </button>
        </nav>
      </header>
      <div className="workspace-bar">
        <button
          className={`icon-button ${library ? "active" : ""}`}
          aria-label="切換文獻庫"
          aria-expanded={library}
          onClick={() => setLibrary(!library)}
        >
          <PanelLeft size={17} />
        </button>
        <div className="document-tabs">
          {w.documents.length ? (
            w.documents.map((d) => (
              <button
                className={d.id === activeId ? "active" : ""}
                key={d.id}
                onClick={() => activate(d.id)}
              >
                <FileText size={13} />
                <span>{d.name}</span>
                {d.id === activeId && <i />}
              </button>
            ))
          ) : (
            <span className="no-document-label">
              你的閱讀清單，從一篇文獻開始。
            </span>
          )}
        </div>
        <button
          className="import-button"
          disabled={!!busy}
          onClick={() => fileRef.current?.click()}
        >
          <Plus size={15} />
          <span>匯入 PDF</span>
        </button>
        <span className="save-status">
          {online ? <Check size={12} /> : <WifiOff size={12} />}
          <span>
            {saveError ? "保存失敗" : online ? "已保存於本機" : "離線閱讀"}
          </span>
        </span>
      </div>
      {saveError && (
        <div className="persistent-error" role="alert">
          {saveError}
          <button onClick={() => setExportOpen(true)}>匯出備份</button>
        </div>
      )}
      <div className="main-workspace">
        {library && (
          <aside className="library">
            <div className="library-heading">
              <span>
                文獻庫 <b>{w.documents.length}</b>
              </span>
              <button
                className="icon-button"
                aria-label="新增 PDF"
                disabled={!!busy}
                onClick={() => fileRef.current?.click()}
              >
                <Plus size={16} />
              </button>
            </div>
            <span className="library-eyebrow">YOUR COLLECTION</span>
            <div className="library-list">
              {w.documents.map((d, index) => {
                const all = w.blocks.filter((b) => b.documentId === d.id),
                  translated = all.filter((b) => validResult(w, b)).length;
                return (
                  <div
                    className={`library-item ${d.id === activeId ? "active" : ""}`}
                    key={d.id}
                  >
                    <button
                      className="library-document"
                      onClick={() => activate(d.id)}
                    >
                      <span className="document-icon">
                        <FileText size={20} />
                        <small>{String(index + 1).padStart(2, "0")}</small>
                      </span>
                      <div>
                        <strong>{d.name.replace(/\.pdf$/i, "")}</strong>
                        <p>
                          {d.pageCount} 頁 <i /> {translated}／
                          {all.filter((b) => b.eligibility === "ready").length}{" "}
                          段已翻譯
                        </p>
                        <span className="mini-progress">
                          <i
                            style={{
                              width: `${all.length ? (translated / all.length) * 100 : 0}%`,
                            }}
                          />
                        </span>
                      </div>
                    </button>
                    <button
                      className="remove-document icon-button"
                      aria-label={`移除 ${d.name}`}
                      disabled={!!busy}
                      onClick={() => {
                        if (
                          confirm(
                            `移除「${d.name}」及其譯文、摘要？請先確認已匯出備份。`,
                          )
                        )
                          void removeDocument(d.id).catch((e) =>
                            toast(e.message),
                          );
                      }}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                );
              })}
              {!w.documents.length && (
                <div className="library-empty">
                  <FolderOpen size={30} />
                  <p>
                    留一點空間，
                    <br />
                    給下一個好問題。
                  </p>
                </div>
              )}
              <button
                className="add-document"
                disabled={!!busy}
                onClick={() => fileRef.current?.click()}
              >
                <FilePlus2 size={16} />
                帶入一篇文獻
              </button>
            </div>
            <div className="library-bottom">
              <ShieldCheck size={17} />
              <div>
                <strong>你的資料，由你保管。</strong>
                <p>
                  原文與研究只保存在這台裝置。
                  <br />
                  記得定期匯出備份。
                </p>
              </div>
            </div>
            <button
              className="clear-workspace"
              disabled={!!busy}
              onClick={() => {
                if (
                  confirm(
                    "永久清除此網站的本機研究？這無法復原，請先匯出完整備份。",
                  )
                )
                  void replaceWorkspace(emptyWorkspace(), [])
                    .then(() => {
                      clearAllKeys();
                      toast("本機研究與目前分頁金鑰已清除");
                    })
                    .catch((e) => toast(e.message));
              }}
            >
              清空本機研究
            </button>
          </aside>
        )}
        <main className="reading-space">
          {paper && (
            <div className="reading-heading">
              <div>
                <span className="eyebrow">READING, AT YOUR OWN PACE</span>
                <h2>{paper.name.replace(/\.pdf$/i, "")}</h2>
              </div>
              <div className="reading-actions">
                <button
                  className="secondary-button"
                  aria-label="全文翻譯"
                  disabled={!!busy || !!running}
                  onClick={() => setTask("translation")}
                >
                  <Languages size={15} />
                  <span>全文翻譯</span>
                </button>
                <button
                  className={`secondary-button ${summary ? "selected" : ""}`}
                  onClick={() => setSummary(!summary)}
                >
                  <Sparkles size={15} />
                  <span>全文摘要</span>
                </button>
              </div>
            </div>
          )}
          <div className="reader-layout">
            <PdfViewer
              onImport={() => fileRef.current?.click()}
              onSample={() => void sample()}
            />
            {summary && paper && (
              <SummaryPanel
                key={paper.id}
                close={() => setSummary(false)}
                onGenerate={() => setTask("summary")}
              />
            )}
          </div>
        </main>
      </div>
      <footer className="app-footer">
        {busy ? (
          <span>
            <LoaderCircle size={13} className="spin" />
            {busy}
          </span>
        ) : running ? (
          <span>
            <LoaderCircle size={13} className="spin" />
            {running.kind === "translation" ? "逐段翻譯" : "全文摘要"} ·{" "}
            {running.kind === "translation"
              ? `${running.blockIds.filter((id) => running.parts.filter((p) => p.blockId === id).every((p) => p.result)).length}／${running.blockIds.length} 段`
              : `${running.chunks.filter((c) => c.result).length}／${running.chunks.length} 原文分塊`}{" "}
            · {running.config.model}
          </span>
        ) : (
          <span>
            <HardDrive size={12} />
            {paper
              ? `${done} 段已翻譯 · ${blocks.filter((b) => b.eligibility === "review").length} 段待檢查 · ${blocks.filter((b) => b.eligibility === "excluded").length} 段已排除`
              : "每個想法，都值得讀懂。"}
          </span>
        )}
        <div>
          {runningId && (
            <button className="text-button" onClick={pauseTask}>
              <Pause size={13} />
              暫停
            </button>
          )}
          {!running && last && last.status !== "complete" && (
            <button
              className="text-button"
              onClick={() => void runJob(last, true)}
            >
              <Play size={13} />
              接續翻譯 · {last.config.model}
            </button>
          )}
          <span className="footer-brand">LOCAL FIRST · THOUGHTFULLY READ</span>
        </div>
      </footer>
      <input
        hidden
        ref={fileRef}
        data-testid="pdf-input"
        type="file"
        accept="application/pdf,.pdf"
        multiple
        onChange={(e) => {
          if (e.target.files) void handleFiles([...e.target.files]);
        }}
      />
      <input
        hidden
        ref={restoreRef}
        data-testid="restore-input"
        type="file"
        accept=".researchpack,.json"
        onChange={(e) => {
          if (e.target.files?.[0]) void restore(e.target.files[0]);
        }}
      />
      {settingsOpen && (
        <Settings close={() => useApp.setState({ settingsOpen: false })} />
      )}
      {exportOpen && <ExportDialog close={() => setExportOpen(false)} />}
      {help && <Help close={() => setHelp(false)} />}
      {task && paper && (
        <ConfirmTask
          kind={task}
          close={() => setTask(undefined)}
          onStarted={() => {
            if (task === "summary") setSummary(true);
          }}
        />
      )}
      {incoming && (
        <Modal
          title="還原研究空間"
          description="檔案已通過格式、來源與關聯驗證。"
          close={() => setIncoming(undefined)}
        >
          <div className="task-confirm">
            <h3>{incoming.workspace.title}</h3>
            <p className="restore-count">
              {incoming.workspace.documents.length} 篇文獻 ·{" "}
              {incoming.workspace.results.length} 個譯文版本 ·{" "}
              {
                incoming.workspace.blocks.filter((b) => !b.currentResultId)
                  .length
              }{" "}
              段未完成 · {incoming.workspace.summaries.length} 份摘要
            </p>
            {incoming.warnings.map((s) => (
              <p className="warning" key={s}>
                {s}
              </p>
            ))}
            <div className="error-box">
              還原會取代目前研究空間。請先下載目前研究的備份；未完成任務會暫停，還原後不會自動呼叫
              AI。
            </div>
            <button className="text-button" onClick={() => setExportOpen(true)}>
              <Download size={14} />
              先匯出目前研究
            </button>
            <div className="dialog-actions">
              <button
                className="secondary-button"
                onClick={() => setIncoming(undefined)}
              >
                取消
              </button>
              <button
                className="primary-button"
                onClick={() => {
                  void replaceWorkspace(incoming.workspace, incoming.files)
                    .then(() => {
                      setIncoming(undefined);
                      toast("研究已還原，可接續閱讀。");
                    })
                    .catch((e) => toast(e.message));
                }}
              >
                確認取代並還原
                <ChevronRight size={15} />
              </button>
            </div>
          </div>
        </Modal>
      )}
      {notice && (
        <div className="toast" role="status">
          <Check size={15} />
          <span>{notice}</span>
          <button
            className="icon-button"
            aria-label="關閉通知"
            onClick={() => useApp.setState({ notice: "" })}
          >
            <X size={14} />
          </button>
        </div>
      )}
      {dragging && (
        <div className="drop-overlay">
          <Upload size={38} />
          <h2>把文獻放進來。</h2>
          <p>放開滑鼠，開始你的下一段閱讀。</p>
        </div>
      )}
    </div>
  );
}
export default function App() {
  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  );
}
