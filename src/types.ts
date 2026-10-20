import { z } from "zod";
export const APP_ID = "educatres.PaperTranslator";
export const NS = "PaperTranslator.v1";
export const LAYOUT_VERSION = "geometry-1";
export const now = () => new Date().toISOString();
export const uid = () => crypto.randomUUID();
const id = z.string().min(1).max(220);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const text = z.string().max(5_000_000);
const point = z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]);
export const quadSchema = z.tuple([point, point, point, point]);
export type Quad = z.infer<typeof quadSchema>;
export const providerSchema = z.enum([
  "openai",
  "cgu",
  "gemini",
  "mercuryapi",
  "grok",
]);
export type Provider = z.infer<typeof providerSchema>;
export type ReasoningEffort = "low" | "medium" | "high";
export const usesReasoningEffort = (p: Provider) =>
  !["gemini", "grok"].includes(p);
export const configSchema = z
  .object({
    provider: providerSchema,
    model: z.string().min(1).max(200),
    reasoningEffort: z.enum(["low", "medium", "high"]).optional(),
  })
  .strict();
export type AIConfig = z.infer<typeof configSchema>;
export const aiResultSchema = configSchema
  .extend({
    text,
    createdAt: z.string(),
    usage: z.number().nonnegative().optional(),
  })
  .strict();
export type AIResult = z.infer<typeof aiResultSchema>;
export const sourceSchema = z
  .object({
    itemIndex: z.number().int().nonnegative(),
    start: z.number().int().nonnegative(),
    end: z.number().int().positive(),
  })
  .strict();
export const lineSchema = z
  .object({ text, quad: quadSchema, sources: z.array(sourceSchema).min(1) })
  .strict();
export const blockSchema = z
  .object({
    id,
    documentId: id,
    pageIndex: z.number().int().nonnegative(),
    regionId: id,
    columnId: id,
    order: z.number().int().nonnegative(),
    role: z.enum([
      "body",
      "heading",
      "caption",
      "footnote",
      "reference",
      "header-footer",
      "formula",
      "table",
    ]),
    rawText: text,
    normalizedText: text,
    sourceHash: hash,
    layoutVersion: id,
    lines: z.array(lineSchema).min(1),
    boundary: z.boolean(),
    confidence: z.number().min(0).max(1),
    eligibility: z.enum(["ready", "review", "excluded"]),
    warnings: z.array(z.string().max(400)),
    currentResultId: id.optional(),
  })
  .strict();
export type TranslationBlock = z.infer<typeof blockSchema>;
export const pageSchema = z
  .object({
    documentId: id,
    pageIndex: z.number().int().nonnegative(),
    width: z.number().positive().max(100000),
    height: z.number().positive().max(100000),
    nativeRotation: z.number(),
    viewBox: z.array(z.number().finite()).length(4),
    transform: z.array(z.number().finite()).length(6),
    text,
    warnings: z.array(z.string().max(400)),
    regions: z.array(z.object({ id, columns: z.array(id).min(1) }).strict()),
  })
  .strict();
export type PageLayout = z.infer<typeof pageSchema>;
export const documentSchema = z
  .object({
    id,
    name: z.string().min(1).max(500),
    sha256: hash,
    size: z
      .number()
      .int()
      .positive()
      .max(150 * 1024 * 1024),
    pageCount: z.number().int().positive().max(10000),
    layoutVersion: id,
    status: z.enum(["indexing", "ready", "partial"]),
    createdAt: z.string(),
    currentSummaryId: id.optional(),
  })
  .strict();
export type Paper = z.infer<typeof documentSchema>;
export const translationResultSchema = aiResultSchema
  .extend({
    id,
    blockId: id,
    sourceHash: hash,
    layoutVersion: id,
    warnings: z.array(z.string()),
    partIds: z.array(id),
  })
  .strict();
export type TranslationResult = z.infer<typeof translationResultSchema>;
export const partSchema = z
  .object({
    id,
    blockId: id,
    partIndex: z.number().int().nonnegative(),
    start: z.number().int().nonnegative(),
    end: z.number().int().positive(),
    text,
    result: aiResultSchema.optional(),
    status: z.enum(["pending", "running", "translated", "failed"]),
    error: z.string().max(1000).optional(),
  })
  .strict();
export type TranslationPart = z.infer<typeof partSchema>;
export const chunkSchema = z
  .object({
    id,
    text,
    startPage: z.number().int().positive(),
    endPage: z.number().int().positive(),
    result: aiResultSchema.optional(),
  })
  .strict();
export type Chunk = z.infer<typeof chunkSchema>;
export const jobSchema = z
  .object({
    id,
    documentId: id,
    documentHash: hash,
    layoutVersion: id,
    config: configSchema,
    kind: z.enum(["translation", "summary"]),
    blockIds: z.array(id),
    parts: z.array(partSchema),
    chunks: z.array(chunkSchema),
    reductions: z.array(chunkSchema),
    status: z.enum([
      "pending",
      "running",
      "paused",
      "partial",
      "failed",
      "complete",
    ]),
    resultId: id.optional(),
    error: z.string().max(1000).optional(),
    owner: id.optional(),
    heartbeat: z.string().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict();
export type Job = z.infer<typeof jobSchema>;
export const summarySchema = aiResultSchema
  .extend({
    id,
    documentId: id,
    jobId: id,
    layoutVersion: id,
    sourcePages: z.array(
      z.tuple([z.number().int().positive(), z.number().int().positive()]),
    ),
  })
  .strict();
export type DocumentSummary = z.infer<typeof summarySchema>;
export const annotationColorSchema = z.enum([
  "yellow",
  "green",
  "blue",
  "pink",
]);
export type AnnotationColor = z.infer<typeof annotationColorSchema>;
export const anchorSchema = z
  .object({
    pageIndex: z.number().int().nonnegative(),
    quads: z.array(quadSchema).min(1).max(5000),
  })
  .strict();
export type AnnotationAnchor = z.infer<typeof anchorSchema>;
export const annotationSchema = z
  .object({
    id,
    documentId: id,
    documentHash: hash,
    kind: z.enum(["highlight", "note", "translation", "summary"]),
    color: annotationColorSchema,
    anchors: z.array(anchorSchema).min(1).max(100),
    quote: z.string().max(50000),
    sourceHash: hash,
    content: z.string().max(50000),
    status: z.enum(["idle", "running", "complete", "failed", "paused"]),
    config: configSchema.optional(),
    results: z.array(aiResultSchema).max(1000),
    error: z.string().max(1000).optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict();
export type Annotation = z.infer<typeof annotationSchema>;
export const workspaceSchema = z
  .object({
    appId: z.literal(APP_ID),
    schemaVersion: z.literal(2),
    id,
    title: z.string().min(1).max(200),
    epoch: id,
    revision: z.number().int().nonnegative(),
    updatedAt: z.string(),
    documents: z.array(documentSchema).max(50),
    pages: z.array(pageSchema).max(100000),
    blocks: z.array(blockSchema).max(200000),
    results: z.array(translationResultSchema).max(500000),
    summaries: z.array(summarySchema).max(10000),
    jobs: z.array(jobSchema).max(10000),
    annotations: z.array(annotationSchema).max(50000),
  })
  .strict();
export type Workspace = z.infer<typeof workspaceSchema>;
export const workspaceInputSchema = z.union([
  workspaceSchema,
  workspaceSchema
    .omit({ annotations: true })
    .extend({ schemaVersion: z.literal(1) })
    .strict()
    .transform((w) => ({ ...w, schemaVersion: 2 as const, annotations: [] })),
]);
export function upgradeWorkspace(w: Workspace): Workspace {
  return (w as { schemaVersion: number }).schemaVersion === 1
    ? workspaceInputSchema.parse(w)
    : w;
}
export const emptyWorkspace = (): Workspace => ({
  appId: APP_ID,
  schemaVersion: 2,
  id: uid(),
  title: "我的論文研究",
  epoch: uid(),
  revision: 0,
  updatedAt: now(),
  documents: [],
  pages: [],
  blocks: [],
  results: [],
  summaries: [],
  jobs: [],
  annotations: [],
});
export interface Preferences {
  provider: Provider;
  models: Record<Provider, string>;
  reasoningEffort: ReasoningEffort;
}
export const defaultPreferences: Preferences = {
  provider: "openai",
  models: {
    openai: "gpt-6-luna",
    cgu: "gpt-6-luna",
    gemini: "",
    mercuryapi: "",
    grok: "",
  },
  reasoningEffort: "medium",
};
