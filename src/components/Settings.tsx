import { useState } from "react";
import {
  KeyRound,
  LoaderCircle,
  ShieldCheck,
  ExternalLink,
  Trash2,
} from "lucide-react";
import { Modal } from "./Modal";
import {
  endpoints,
  hasKey,
  listModels,
  providerName,
  setKey,
  testConnection,
  useCredentials,
  type ModelOption,
} from "../lib/providers";
import { pref, useApp } from "../lib/storage";
import {
  usesReasoningEffort,
  type Provider,
  type ReasoningEffort,
} from "../types";
const providers: Provider[] = ["openai", "cgu", "gemini", "mercuryapi", "grok"];
const links: Record<Provider, string> = {
  openai: "https://platform.openai.com/api-keys",
  cgu: "https://air.cgu.edu.tw/cgullmapi/",
  gemini: "https://aistudio.google.com/apikey",
  mercuryapi: "https://air.cgu.edu.tw/mercuryapi/",
  grok: "https://console.x.ai/",
};
export function Settings({ close }: { close: () => void }) {
  const preferences = useApp((s) => s.preferences);
  useCredentials();
  const { provider, models, reasoningEffort } = preferences;
  const [input, setInput] = useState(""),
    [busy, setBusy] = useState(""),
    [message, setMessage] = useState(""),
    [error, setError] = useState(false),
    [options, setOptions] = useState<Partial<Record<Provider, ModelOption[]>>>(
      {},
    );
  const setModel = (model: string) =>
    pref({
      models: { ...useApp.getState().preferences.models, [provider]: model },
    });
  async function action(type: "models" | "save" | "test") {
    setBusy(type);
    setMessage("");
    setError(false);
    try {
      if (type === "save") {
        setKey(provider, input);
        setInput("");
        if (!["mercuryapi", "grok", "gemini"].includes(provider)) {
          setMessage("金鑰已暫存在目前分頁。可取得模型清單或測試連線。");
          return;
        }
      }
      if (type === "test") {
        await testConnection(provider, models[provider], reasoningEffort);
        setMessage("連線成功：所選模型已完成文字生成。");
      } else {
        const found = await listModels(provider);
        setOptions((s) => ({ ...s, [provider]: found }));
        if (!found.length) throw new Error("沒有可用模型，請確認帳戶權限。");
        if (!found.some((m) => m.id === models[provider])) {
          if (provider === "gemini")
            setModel(
              found.some((m) => m.id === "gemini-flash-lite-latest")
                ? "gemini-flash-lite-latest"
                : "",
            );
          else if (["mercuryapi", "grok"].includes(provider))
            setModel(found[0].id);
        }
        setMessage(
          `已取得 ${found.length} 個模型。清單不代表已驗證文字生成權限。`,
        );
      }
    } catch (e) {
      setError(true);
      setMessage((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  return (
    <Modal
      title="連接你的 AI"
      description="選擇供應商，用自己的金鑰邀請 AI 協助閱讀。"
      close={close}
    >
      <div className="provider-tabs">
        {providers.map((p) => (
          <button
            key={p}
            aria-pressed={provider === p}
            className={provider === p ? "active" : ""}
            disabled={!!busy}
            onClick={() => {
              pref({ provider: p });
              setInput("");
              setMessage("");
            }}
          >
            {providerName(p)}
          </button>
        ))}
      </div>
      <div className="settings-body">
        <div className="api-endpoint">
          <span>Base URL</span>
          <code>{endpoints[provider]}</code>
        </div>
        <label className="field">
          你的 API key{" "}
          {hasKey(provider) && (
            <span className="connected-label">本分頁已設定</span>
          )}
          <input
            aria-label="你的 API key"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder={
              hasKey(provider)
                ? "***"
                : provider === "grok"
                  ? "xai-…"
                  : "貼上你的 API key"
            }
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
        </label>
        <div className="field-actions">
          <a href={links[provider]} target="_blank" rel="noreferrer">
            <ExternalLink size={13} />
            取得 {providerName(provider)} 金鑰
          </a>
          <button
            className="small-button"
            disabled={!input.trim() || !!busy}
            onClick={() => void action("save")}
          >
            使用此金鑰
          </button>
        </div>
        {provider === "cgu" && (
          <p className="field-help">
            接受純金鑰、Bearer 或 Authorization: Bearer 前綴。驗證僅查詢
            /models。
          </p>
        )}
        <label className="field">
          模型選項
          <select
            aria-label="模型選項"
            value={
              (options[provider] || []).some((m) => m.id === models[provider])
                ? models[provider]
                : ""
            }
            onChange={(e) => setModel(e.target.value)}
          >
            <option value="">選擇模型或在下方輸入 ID</option>
            {(options[provider] || []).map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <div className="field-actions">
          <button
            className="text-button"
            disabled={!hasKey(provider) || !!busy}
            onClick={() => void action("models")}
          >
            {provider === "cgu" ? "驗證 CGU 金鑰／取得模型" : "自動偵測模型"}
          </button>
          {["openai", "cgu"].includes(provider) && (
            <div className="model-shortcuts">
              {["gpt-6-luna", "gpt-5.6-luna"].map((m) => (
                <button key={m} onClick={() => setModel(m)}>
                  {m}
                </button>
              ))}
            </div>
          )}
        </div>
        <label className="field">
          模型 ID
          <input
            aria-label="模型 ID"
            value={models[provider]}
            onChange={(e) => setModel(e.target.value)}
            placeholder="例如 gpt-6-luna"
            spellCheck={false}
          />
        </label>
        <p className="field-help">
          模型選項沿用 PaperReader；實際可用性與費用以供應商帳戶為準。
        </p>
        <label className="field">
          推理程度
          <select
            aria-label="推理程度"
            disabled={!usesReasoningEffort(provider)}
            value={reasoningEffort}
            onChange={(e) =>
              pref({ reasoningEffort: e.target.value as ReasoningEffort })
            }
          >
            <option value="low">低</option>
            <option value="medium">中（預設）</option>
            <option value="high">高</option>
          </select>
        </label>
        {!usesReasoningEffort(provider) && (
          <p className="field-help">此供應商使用模型預設推理設定。</p>
        )}
        {message && (
          <div
            role="status"
            className={`settings-message ${error ? "error" : ""}`}
          >
            {message}
          </div>
        )}
        <div className="privacy-note">
          <ShieldCheck size={21} />
          <p>
            金鑰只留在目前分頁記憶體，重新整理即清除。只在你啟動翻譯或摘要時傳送所選原文；原始
            PDF 留在本機。測試連線會產生少量用量。
          </p>
        </div>
        <div className="settings-footer">
          <button
            className="text-button danger"
            disabled={!hasKey(provider) || !!busy}
            onClick={() => {
              setKey(provider, "");
              setInput("");
              setMessage("已清除目前供應商金鑰。");
            }}
          >
            <Trash2 size={13} />
            清除本機 API Key
          </button>
          <button
            className="secondary-button"
            disabled={!hasKey(provider) || !models[provider] || !!busy}
            onClick={() => void action("test")}
          >
            {busy ? (
              <LoaderCircle size={14} className="spin" />
            ) : (
              <KeyRound size={14} />
            )}
            測試連線
          </button>
          <button className="primary-button" onClick={close}>
            完成
          </button>
        </div>
      </div>
    </Modal>
  );
}
