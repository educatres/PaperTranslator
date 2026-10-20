import "fake-indexeddb/auto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
vi.stubGlobal("window", new EventTarget());
const { emptyWorkspace, now } = await import("../src/types");
const { analyzeLayout } = await import("../src/lib/layout");
const { validateWorkspace, pausedSnapshot, inspectZip } =
  await import("../src/lib/transfer");
const { splitParts } = await import("../src/lib/tasks");
const { db, mutate, useApp } = await import("../src/lib/storage");
const { default: JSZip } = await import("jszip");
async function fixture() {
  const w = emptyWorkspace(),
    hash = "b".repeat(64);
  w.documents.push({
    id: "doc",
    name: "test.pdf",
    sha256: hash,
    size: 120,
    pageCount: 2,
    layoutVersion: "geometry-1",
    status: "ready",
    createdAt: now(),
  });
  const { page, blocks } = await analyzeLayout(
    "doc",
    hash,
    0,
    [
      {
        text: "A valid scientific paragraph with 42 mg [1].",
        x: 0.1,
        y: 0.2,
        width: 0.8,
        height: 0.02,
        font: "Regular",
        itemIndex: 0,
      },
    ],
    {
      width: 600,
      height: 800,
      nativeRotation: 0,
      viewBox: [0, 0, 600, 800],
      transform: [1, 0, 0, -1, 0, 800],
    },
  );
  w.pages = [page];
  w.blocks = blocks;
  return w;
}
afterAll(() => db.close());
it("accepts valid geometry and rejects invalid references, hashes, IDs and columns", async () => {
  const w = await fixture();
  await expect(validateWorkspace(w)).resolves.toMatchObject({
    documents: [{ id: "doc" }],
  });
  for (const change of [
    (w: Awaited<ReturnType<typeof fixture>>) => {
      w.blocks[0].sourceHash = "c".repeat(64);
    },
    (w: Awaited<ReturnType<typeof fixture>>) => {
      w.blocks[0].columnId = "missing";
    },
    (w: Awaited<ReturnType<typeof fixture>>) => {
      w.blocks[0].currentResultId = "missing";
    },
    (w: Awaited<ReturnType<typeof fixture>>) => {
      w.documents.push(w.documents[0]);
    },
    (w: Awaited<ReturnType<typeof fixture>>) => {
      w.blocks[0].lines[0].quad[0][0] = NaN;
    },
  ]) {
    const draft = structuredClone(w);
    change(draft);
    await expect(validateWorkspace(draft)).rejects.toThrow();
  }
});
it("splits long paragraphs without overlap, omissions or broken surrogate pairs", async () => {
  const w = await fixture(),
    b = w.blocks[0];
  b.normalizedText = "A sentence with an emoji 🧠 and 42 units. ".repeat(500);
  const parts = splitParts(b, 200);
  expect(parts.map((p) => p.text).join("")).toBe(b.normalizedText);
  expect(
    parts.every(
      (p, i) =>
        p.start === (i ? parts[i - 1].end : 0) &&
        p.text.length <= 200 &&
        !/[\uD800-\uDBFF]$/.test(p.text),
    ),
  ).toBe(true);
});
it("serializes interrupted jobs as paused without changing the live state", async () => {
  const w = await fixture();
  w.jobs.push({
    id: "job",
    kind: "translation",
    documentId: "doc",
    documentHash: w.documents[0].sha256,
    layoutVersion: "geometry-1",
    config: { provider: "grok", model: "grok-text" },
    blockIds: [w.blocks[0].id],
    parts: splitParts(w.blocks[0]),
    chunks: [],
    reductions: [],
    status: "running",
    owner: "window",
    createdAt: now(),
    updatedAt: now(),
  });
  w.jobs[0].parts[0].status = "running";
  const snap = pausedSnapshot(w);
  expect(snap.jobs[0].status).toBe("paused");
  expect(snap.jobs[0].parts[0].status).toBe("pending");
  expect(w.jobs[0].status).toBe("running");
});
it("inspects ZIP central entries before path normalization", async () => {
  for (const name of [
    "../escape.pdf",
    "C:/secret.pdf",
    "/absolute.pdf",
    "a\\b.pdf",
  ]) {
    const zip = new JSZip();
    zip.file(name, "hello");
    const bytes = await zip.generateAsync({ type: "arraybuffer" });
    expect(() => inspectZip(bytes)).toThrow();
  }
  const valid = new JSZip();
  valid.file("research.json", "{}");
  expect(
    inspectZip(await valid.generateAsync({ type: "arraybuffer" })),
  ).toContain("research.json");
});
it("rejects old app identity and secret-bearing extra fields", async () => {
  const w = await fixture();
  await expect(
    validateWorkspace({ ...w, appId: "PaperReader" }),
  ).rejects.toThrow();
  await expect(
    validateWorkspace({ ...w, apiKey: "never-store" }),
  ).rejects.toThrow();
});
it("commits progress atomically and prevents stale epoch writes", async () => {
  const w = await fixture();
  await db.research.put({ id: "workspace", data: w });
  await mutate((draft) => {
    draft.title = "Committed title";
  }, w.epoch);
  await expect(
    mutate((draft) => {
      draft.title = "Stale write";
    }, "wrong-epoch"),
  ).rejects.toThrow("變更");
  expect((await db.research.get("workspace"))!.data.title).toBe(
    "Committed title",
  );
});
it("upgrades v1 research without changing paragraph IDs and rejects annotation corruption", async () => {
  const w = await fixture();
  const legacy: Record<string, unknown> = { ...w, schemaVersion: 1 };
  delete legacy.annotations;
  const migrated = await validateWorkspace(legacy);
  expect(migrated.schemaVersion).toBe(2);
  expect(migrated.annotations).toEqual([]);
  expect(migrated.blocks).toEqual(w.blocks);
  const { sha256 } = await import("../src/lib/hash");
  w.annotations.push({
    id: "annotation",
    documentId: "doc",
    documentHash: w.documents[0].sha256,
    kind: "note",
    color: "pink",
    anchors: [{ pageIndex: 0, quads: [w.blocks[0].lines[0].quad] }],
    quote: "source",
    sourceHash: await sha256("source"),
    content: "我的便條",
    results: [],
    status: "idle",
    createdAt: now(),
    updatedAt: now(),
  });
  await expect(validateWorkspace(w)).resolves.toMatchObject({
    annotations: [{ content: "我的便條" }],
  });
  for (const patch of [
    { documentId: "missing" },
    { sourceHash: "c".repeat(64) },
    { color: "red" },
    { anchors: [{ pageIndex: 7, quads: [w.blocks[0].lines[0].quad] }] },
    { status: "complete" },
  ]) {
    await expect(
      validateWorkspace({
        ...w,
        annotations: [{ ...w.annotations[0], ...patch }],
      }),
    ).rejects.toThrow();
  }
});
it("exports running selection generation as paused and preserves its successful history", async () => {
  const w = await fixture(),
    { sha256 } = await import("../src/lib/hash");
  w.annotations.push({
    id: "a",
    documentId: "doc",
    documentHash: w.documents[0].sha256,
    kind: "translation",
    color: "blue",
    anchors: [{ pageIndex: 0, quads: [w.blocks[0].lines[0].quad] }],
    quote: "source",
    sourceHash: await sha256("source"),
    content: "",
    status: "running",
    config: { provider: "openai", model: "test-model" },
    results: [
      {
        provider: "openai",
        model: "test-model",
        text: "先前譯文",
        createdAt: now(),
      },
    ],
    createdAt: now(),
    updatedAt: now(),
  });
  const snapshot = pausedSnapshot(w);
  expect(snapshot.annotations[0].status).toBe("paused");
  expect(snapshot.annotations[0].results[0].text).toBe("先前譯文");
  expect(w.annotations[0].status).toBe("running");
  await expect(validateWorkspace(snapshot)).resolves.toBeDefined();
});
