import Dexie, { type Table } from "dexie";
import { create } from "zustand";
import {
  NS,
  defaultPreferences,
  emptyWorkspace,
  now,
  providerSchema,
  uid,
  upgradeWorkspace,
  type Preferences,
  type Workspace,
} from "../types";

export class ResearchDB extends Dexie {
  research!: Table<{ id: string; data: Workspace }>;
  files!: Table<{ id: string; blob: Blob }>;
  constructor(name = NS) {
    super(name);
    this.version(1).stores({ research: "id", files: "id" });
  }
}
export const db = new ResearchDB();
const channel =
  typeof BroadcastChannel !== "undefined"
    ? new BroadcastChannel(`${NS}.changes`)
    : undefined;
function loadPreferences(): Preferences {
  try {
    const p = JSON.parse(localStorage.getItem(`${NS}.preferences`) || "{}");
    const provider = providerSchema.safeParse(p.provider);
    return {
      provider: provider.success ? provider.data : "openai",
      models: Object.fromEntries(
        Object.entries(defaultPreferences.models).map(([k, v]) => [
          k,
          typeof p.models?.[k] === "string" && p.models[k].length < 201
            ? p.models[k]
            : v,
        ]),
      ) as Preferences["models"],
      reasoningEffort: ["low", "medium", "high"].includes(p.reasoningEffort)
        ? p.reasoningEffort
        : "medium",
    };
  } catch {
    return structuredClone(defaultPreferences);
  }
}
export const useApp = create<{
  workspace: Workspace;
  preferences: Preferences;
  ready: boolean;
  activeId?: string;
  settingsOpen: boolean;
  notice: string;
  saveError: string;
  busy: string;
  runningId?: string;
  fileRevision: number;
  unsavedDraft?: Workspace;
}>(() => ({
  workspace: emptyWorkspace(),
  preferences: loadPreferences(),
  ready: false,
  settingsOpen: false,
  notice: "",
  saveError: "",
  busy: "",
  fileRevision: 0,
}));
export function toast(notice: string) {
  useApp.setState({ notice });
}
export function pref(patch: Partial<Preferences>) {
  const preferences = { ...useApp.getState().preferences, ...patch };
  useApp.setState({ preferences });
  try {
    localStorage.setItem(`${NS}.preferences`, JSON.stringify(preferences));
  } catch {
    toast("瀏覽器無法保存偏好設定；本分頁仍可使用。");
  }
}
export function activate(activeId?: string) {
  useApp.setState({ activeId });
  try {
    sessionStorage.setItem(`${NS}.active`, activeId || "");
  } catch {
    /* View remains in memory. */
  }
}
function publish(workspace: Workspace, fileChanged = false) {
  useApp.setState((s) => ({
    workspace,
    saveError: "",
    fileRevision: s.fileRevision + (fileChanged ? 1 : 0),
    activeId: workspace.documents.some((d) => d.id === s.activeId)
      ? s.activeId
      : workspace.documents[0]?.id,
  }));
  channel?.postMessage({
    revision: workspace.revision,
    epoch: workspace.epoch,
    fileChanged,
  });
}
export async function refresh() {
  const record = await db.research.get("workspace");
  if (useApp.getState().unsavedDraft) return;
  if (record)
    useApp.setState((s) => ({
      workspace: upgradeWorkspace(record.data),
      activeId: record.data.documents.some((d) => d.id === s.activeId)
        ? s.activeId
        : record.data.documents[0]?.id,
    }));
}
channel?.addEventListener("message", (e) => {
  void refresh()
    .then(() => {
      if (e.data.fileChanged)
        useApp.setState((s) => ({ fileRevision: s.fileRevision + 1 }));
    })
    .catch(() => toast("讀取其他視窗的變更失敗，請重新整理。"));
});
export async function mutate(
  edit: (w: Workspace) => void,
  epoch?: string,
  file?: { id: string; blob: Blob },
): Promise<Workspace> {
  if (useApp.getState().unsavedDraft)
    throw new Error("尚有未保存的生成結果，請先匯出備份，再還原或重新整理。");
  try {
    const result = await db.transaction(
      "rw",
      db.research,
      db.files,
      async () => {
        const current = upgradeWorkspace(
          (await db.research.get("workspace"))?.data || emptyWorkspace(),
        );
        if (epoch && current.epoch !== epoch)
          throw new Error("研究空間已變更，這次操作已停止。");
        edit(current);
        current.revision++;
        current.updatedAt = now();
        if (file) await db.files.put(file);
        await db.research.put({ id: "workspace", data: current });
        return current;
      },
    );
    publish(result, !!file);
    return result;
  } catch (e) {
    useApp.setState({
      saveError: "保存失敗。請保留此分頁並匯出備份，檢查瀏覽器儲存空間後重試。",
    });
    throw e;
  }
}
export async function replaceWorkspace(
  workspace: Workspace,
  files: { id: string; blob: Blob }[],
) {
  if (!navigator.locks) throw new Error("此瀏覽器不支援研究還原所需的執行鎖。");
  await navigator.locks.request(
    `${NS}.generation`,
    { ifAvailable: true },
    async (lock) => {
      if (!lock)
        throw new Error("其他視窗仍在執行 AI 任務，請先暫停後再還原。");
      const next = structuredClone(workspace);
      next.epoch = uid();
      next.revision++;
      next.updatedAt = now();
      for (const job of next.jobs)
        if (job.status !== "complete") {
          job.status = "paused";
          delete job.owner;
          for (const p of job.parts)
            if (p.status === "running") p.status = "pending";
        }
      for (const annotation of next.annotations)
        if (annotation.status === "running") annotation.status = "paused";
      await db.transaction("rw", db.research, db.files, async () => {
        await db.files.clear();
        await db.files.bulkPut(files);
        await db.research.put({ id: "workspace", data: next });
      });
      useApp.setState({ unsavedDraft: undefined });
      publish(next);
      window.dispatchEvent(new Event(`${NS}.reset`));
    },
  );
}
export async function removeDocument(id: string) {
  if (!navigator.locks) throw new Error("此瀏覽器不支援安全移除所需的執行鎖。");
  await navigator.locks.request(
    `${NS}.generation`,
    { ifAvailable: true },
    async (lock) => {
      if (!lock) throw new Error("請先暫停目前執行的 AI 任務，再移除文獻。");
      const w = await db.transaction("rw", db.files, db.research, async () => {
        const data = upgradeWorkspace(
          (await db.research.get("workspace"))!.data,
        );
        const blockIds = new Set(
          data.blocks.filter((b) => b.documentId === id).map((b) => b.id),
        );
        data.documents = data.documents.filter((d) => d.id !== id);
        data.blocks = data.blocks.filter((b) => b.documentId !== id);
        data.pages = data.pages.filter((p) => p.documentId !== id);
        data.results = data.results.filter((r) => !blockIds.has(r.blockId));
        data.jobs = data.jobs.filter((j) => j.documentId !== id);
        data.summaries = data.summaries.filter((s) => s.documentId !== id);
        data.annotations = data.annotations.filter((a) => a.documentId !== id);
        data.epoch = uid();
        data.revision++;
        data.updatedAt = now();
        await db.files.delete(id);
        await db.research.put({ id: "workspace", data });
        return data;
      });
      publish(w);
      window.dispatchEvent(new Event(`${NS}.reset`));
    },
  );
}
let initializing: Promise<void> | undefined;
export function initialize() {
  return (initializing ||= (async () => {
    await db.transaction("rw", db.research, async () => {
      if (!(await db.research.get("workspace")))
        await db.research.put({ id: "workspace", data: emptyWorkspace() });
    });
    await refresh();
    if (navigator.locks)
      await navigator.locks.request(
        `${NS}.generation`,
        { ifAvailable: true },
        async (lock) => {
          if (!lock) return;
          if (
            useApp
              .getState()
              .workspace.jobs.some((j) => j.status === "running") ||
            useApp
              .getState()
              .workspace.annotations.some((a) => a.status === "running")
          )
            await mutate((w) => {
              for (const a of w.annotations)
                if (a.status === "running") a.status = "paused";
              for (const j of w.jobs)
                if (j.status === "running") {
                  j.status = "paused";
                  delete j.owner;
                  for (const p of j.parts)
                    if (p.status === "running") p.status = "pending";
                }
            });
        },
      );
    let active: string | null = null;
    try {
      active = sessionStorage.getItem(`${NS}.active`);
    } catch {
      /* Default document. */
    }
    if (
      active &&
      useApp.getState().workspace.documents.some((d) => d.id === active)
    )
      activate(active);
    useApp.setState({ ready: true });
  })());
}
