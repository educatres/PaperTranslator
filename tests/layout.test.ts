import { describe, expect, it } from "vitest";
import {
  analyzeLayout,
  findGutter,
  normalizeParagraph,
  type TextRun,
} from "../src/lib/layout";
import { projectPoint } from "../src/lib/geometry";
const meta = {
  width: 600,
  height: 800,
  nativeRotation: 0,
  viewBox: [20, 30, 620, 830],
  transform: [1, 0, 0, -1, -20, 830],
};
const hash = "a".repeat(64);
function lines(
  count: number,
  x = 0.1,
  start = 0.2,
  width = 0.8,
  font = "Regular",
  first = 0,
): TextRun[] {
  return Array.from({ length: count }, (_, i) => ({
    text: `Evidence line ${i + 1} continues with the next line`,
    x,
    y: start + i * 0.022,
    width,
    height: 0.016,
    font,
    itemIndex: first + i,
  }));
}
describe("annotated layout boundaries", () => {
  it("groups six contiguous lines into one paragraph", async () => {
    const r = await analyzeLayout("doc", hash, 0, lines(6), meta);
    expect(r.blocks).toHaveLength(1);
    expect(r.blocks[0].lines).toHaveLength(6);
  });
  it("separates paragraphs by gap and indentation", async () => {
    const input = [...lines(3), ...lines(3, 0.1, 0.31, 0.8, "Regular", 3)];
    const r = await analyzeLayout("doc", hash, 0, input, meta);
    expect(r.blocks).toHaveLength(2);
    const indented = lines(6);
    indented[3].x += 0.025;
    indented[3].width -= 0.025;
    expect(
      (await analyzeLayout("doc", hash, 0, indented, meta)).blocks,
    ).toHaveLength(2);
  });
  it("never interleaves columns with identical baselines", async () => {
    const input = [
      ...lines(6, 0.08, 0.2, 0.38),
      ...lines(6, 0.55, 0.2, 0.37, "Regular", 6),
    ];
    const r = await analyzeLayout("doc", hash, 0, input, meta);
    expect(r.blocks).toHaveLength(2);
    expect(r.blocks.map((b) => b.columnId)).toEqual(["left", "right"]);
    expect(r.blocks.every((b) => b.lines.length === 6)).toBe(true);
  });
  it("detects an asymmetric gutter from text, rather than page midpoint", async () => {
    const input = [
      ...lines(6, 0.06, 0.2, 0.22),
      ...lines(6, 0.35, 0.2, 0.57, "Regular", 6),
    ];
    expect(findGutter(input)).toBeLessThan(0.4);
    const r = await analyzeLayout("doc", hash, 0, input, meta);
    expect(new Set(r.blocks.map((b) => b.columnId)).size).toBe(2);
  });
  it("creates independent full-width regions around columns", async () => {
    const input = [
      ...lines(1, 0.1, 0.08, 0.8, "Bold", 50),
      ...lines(6, 0.08, 0.2, 0.38),
      ...lines(6, 0.55, 0.2, 0.37, "Regular", 6),
      ...lines(1, 0.08, 0.5, 0.84, "Regular", 51),
      ...lines(5, 0.08, 0.6, 0.38, "Regular", 60),
      ...lines(5, 0.55, 0.6, 0.37, "Regular", 70),
    ];
    const r = await analyzeLayout("doc", hash, 0, input, meta);
    expect(r.page.regions).toHaveLength(4);
    expect(r.blocks.filter((b) => b.columnId === "full")).toHaveLength(2);
    expect(r.blocks.filter((b) => b.columnId === "left")).toHaveLength(2);
  });
  it("keeps cross-page fragments and repeated text at distinct source locations", async () => {
    const first = await analyzeLayout("doc", hash, 0, lines(4), meta),
      next = await analyzeLayout("doc", hash, 1, lines(4), meta);
    expect(first.blocks[0].id).not.toBe(next.blocks[0].id);
    const repeat = await analyzeLayout(
      "doc",
      hash,
      0,
      [...lines(2), ...lines(2, 0.1, 0.5, 0.8, "Regular", 10)],
      meta,
    );
    expect(repeat.blocks).toHaveLength(2);
    expect(repeat.blocks[0].id).not.toBe(repeat.blocks[1].id);
    expect(repeat.blocks[0].sourceHash).toBe(repeat.blocks[1].sourceHash);
  });
  it("deduplicates overprinted runs and preserves source ranges", async () => {
    const input = lines(4);
    const r = await analyzeLayout(
      "doc",
      hash,
      0,
      [...input, { ...input[0], itemIndex: 10 }],
      meta,
    );
    expect(r.blocks[0].lines).toHaveLength(4);
    expect(r.blocks[0].lines[0].sources[0]).toEqual({
      itemIndex: 0,
      start: 0,
      end: input[0].text.length,
    });
  });
  it("retains separate inline items within a line", async () => {
    const r = await analyzeLayout(
      "doc",
      hash,
      0,
      [
        { ...lines(1)[0], text: "A scientific", width: 0.17 },
        { ...lines(1)[0], text: "result.", x: 0.28, width: 0.15, itemIndex: 1 },
      ],
      meta,
    );
    expect(r.blocks).toHaveLength(1);
    expect(r.blocks[0].normalizedText).toBe("A scientific result.");
    expect(r.blocks[0].lines[0].sources).toHaveLength(2);
  });
  it("marks table-like rows for review and excludes formula/page number", async () => {
    const table = Array.from({ length: 3 }, (_, i) =>
      [0, 0.22, 0.44].map((dx, j) => ({
        ...lines(1, 0.1 + dx, 0.25 + i * 0.025, 0.08)[0],
        text: `Cell${j}`,
        itemIndex: i * 3 + j,
      })),
    ).flat();
    const r = await analyzeLayout("doc", hash, 0, table, meta);
    expect(r.blocks.some((b) => b.eligibility === "review")).toBe(true);
    const f = await analyzeLayout(
      "doc",
      hash,
      0,
      [{ ...lines(1, 0.1, 0.95, 0.2)[0], text: "12" }],
      meta,
    );
    expect(f.blocks[0].eligibility).toBe("excluded");
    const formula = await analyzeLayout(
      "doc",
      hash,
      0,
      [{ ...lines(1)[0], text: "∑ = 1 ± 2" }],
      meta,
    );
    expect(formula.blocks[0].role).toBe("formula");
  });
  it("reports image-only pages as needing OCR", async () => {
    const r = await analyzeLayout("doc", hash, 0, [], meta);
    expect(r.blocks).toHaveLength(0);
    expect(r.page.warnings.join("")).toContain("OCR");
  });
  it("uses stable IDs across repeat extraction", async () => {
    const a = await analyzeLayout("doc", hash, 0, lines(3), meta),
      b = await analyzeLayout("doc", hash, 0, lines(3), meta);
    expect(a.blocks[0].id).toBe(b.blocks[0].id);
  });
  it("normalizes only within a block without deleting numbers or Greek letters", () => {
    expect(normalizeParagraph(["inter-", "national α 23.5 mg [12]"])).toBe(
      "international α 23.5 mg [12]",
    );
    expect(normalizeParagraph(["a boundary-"])).toBe("a boundary-");
  });
});
describe("CropBox and rotation projection", () => {
  it("maps normalized corners through PDF coordinates for all four rotations", () => {
    expect(projectPoint([0.2, 0.3], meta, [2, 0, 0, -2, -40, 1660])).toEqual([
      240, 480,
    ]);
    expect(projectPoint([0.2, 0.3], meta, [0, 1, 1, 0, -30, -20])).toEqual([
      560, 120,
    ]);
    expect(projectPoint([0.2, 0.3], meta, [-1, 0, 0, 1, 620, -30])).toEqual([
      480, 560,
    ]);
    expect(projectPoint([0.2, 0.3], meta, [0, -1, -1, 0, 830, 620])).toEqual([
      240, 480,
    ]);
  });
});
