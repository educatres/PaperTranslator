import { expect, test, type Page, type BrowserContext } from "@playwright/test";
import { readFile } from "node:fs/promises";
const generated = {
  status: "completed",
  output: [
    {
      type: "message",
      content: [
        {
          type: "output_text",
          text: "閱讀是一個主動連結證據與問題的過程。保留原文，讓研究的每個細節更清楚。42 mg [1]",
        },
      ],
    },
  ],
  usage: { total_tokens: 51 },
};
async function sample(page: Page) {
  await page.getByRole("button", { name: "試讀範例文獻" }).click();
  await expect(page.locator(".pdf-page.ready").first()).toBeVisible();
  await expect(page.locator(".app-footer")).not.toContainText("正在辨識");
  await expect(page.locator(".translation-marker").first()).toBeVisible();
}
async function setup(
  page: Page,
  provider = "OpenAI",
  key = "test-session-only-secret",
) {
  await page.getByRole("button", { name: "AI 設定", exact: true }).click();
  await page.getByRole("button", { name: provider, exact: true }).click();
  await page.getByLabel("你的 API key", { exact: true }).fill(key);
  await page.getByRole("button", { name: "使用此金鑰", exact: true }).click();
  await page.getByRole("button", { name: "完成", exact: true }).click();
}
async function translateFirst(page: Page) {
  await page.locator(".translation-marker").first().click();
  await page.getByRole("button", { name: "翻譯此段", exact: true }).click();
  await expect(page.locator(".translated-text")).toContainText("主動連結");
  await expect(
    page.getByRole("button", { name: "重新翻譯", exact: true }),
  ).toBeEnabled();
}
async function getJSON(page: Page) {
  await page.getByRole("button", { name: "匯出研究", exact: true }).click();
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: /JSON 研究資料/ }).click();
  const path = (await (await downloading).path())!;
  return { path, text: await readFile(path, "utf8") };
}
test("reads a two-column PDF, translates only on demand, keeps source anchors and clears credentials on reload", async ({
  page,
}) => {
  const errors: string[] = [],
    requests: any[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("https://api.openai.com/v1/**", (route) => {
    requests.push(route.request().postDataJSON());
    return route.fulfill({ json: generated });
  });
  await page.goto("./");
  await page.screenshot({ path: "test-results/welcome-desktop.png" });
  await sample(page);
  expect(requests).toHaveLength(0);
  await page.locator(".translation-marker").first().hover();
  await expect(page.getByRole("region", { name: "譯文預覽" })).toBeVisible();
  expect(requests).toHaveLength(0);
  await page.mouse.move(0, 0);
  await setup(page);
  await translateFirst(page);
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({
    store: false,
    reasoning: { effort: "medium" },
  });
  const firstId = await page
    .locator(".translation-marker.translated")
    .first()
    .getAttribute("data-marker");
  await page.getByRole("button", { name: "關閉翻譯備註" }).click();
  await page.getByRole("button", { name: "旋轉 PDF" }).click();
  await expect(page.locator(".pdf-page.ready").first()).toBeVisible();
  expect(await page.locator(`[data-marker="${firstId}"]`).count()).toBe(1);
  await page.getByRole("button", { name: "旋轉 PDF" }).click();
  await page.getByRole("button", { name: "旋轉 PDF" }).click();
  await page.getByRole("button", { name: "旋轉 PDF" }).click();
  await page.getByRole("button", { name: "放大 PDF" }).click();
  await page.getByRole("button", { name: "適合寬度" }).click();
  await expect(page.locator(".pdf-page.ready").first()).toBeVisible();
  expect(requests).toHaveLength(1);
  await page.getByRole("button", { name: "搜尋 PDF", exact: true }).click();
  await page.getByLabel("搜尋文獻原文").fill("Translation");
  await expect(
    page.locator(".source-outline.search-match").first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "關閉搜尋", exact: true }).click();
  const json = await getJSON(page),
    data = JSON.parse(json.text);
  expect(data.blocks.some((b: any) => b.columnId === "left")).toBe(true);
  expect(data.blocks.some((b: any) => b.columnId === "right")).toBe(true);
  expect(data.results).toHaveLength(1);
  expect(json.text).not.toContain("test-session-only-secret");
  expect(
    await page.evaluate(() =>
      JSON.stringify({
        local: { ...localStorage },
        session: { ...sessionStorage },
      }),
    ),
  ).not.toContain("test-session-only-secret");
  await page.screenshot({ path: "test-results/reader-desktop.png" });
  await page.reload();
  await expect(page.locator(`[data-marker="${firstId}"]`)).toBeVisible();
  await page.locator(`[data-marker="${firstId}"]`).click();
  await expect(page.locator(".translated-text")).toContainText("主動連結");
  expect(requests).toHaveLength(1);
  await page.getByRole("button", { name: "關閉翻譯備註" }).click();
  await page.getByRole("button", { name: "AI 設定", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "測試連線", exact: true }),
  ).toBeDisabled();
  expect(errors).toEqual([]);
});
test("full translation confirms scope and summary records page ranges independently", async ({
  page,
}) => {
  const requests: any[] = [];
  await page.route("https://api.openai.com/v1/**", (route) => {
    requests.push(route.request().postDataJSON());
    return route.fulfill({ json: generated });
  });
  await page.goto("./");
  await sample(page);
  await setup(page);
  await page.getByRole("button", { name: "全文翻譯", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "全文逐段翻譯" }),
  ).toContainText("待檢查");
  expect(requests).toHaveLength(0);
  await page
    .getByRole("button", { name: "確認並開始翻譯", exact: true })
    .click();
  await expect(page.locator(".app-footer")).toContainText("已翻譯");
  await expect.poll(() => requests.length).toBeGreaterThan(5);
  await expect(
    page.getByRole("button", { name: "全文翻譯", exact: true }),
  ).toBeEnabled({ timeout: 30000 });
  const completed = JSON.parse((await getJSON(page)).text);
  expect(completed.jobs[0].status).toBe("complete");
  expect(completed.results.length).toBe(
    completed.blocks.filter((b: any) => b.eligibility === "ready").length,
  );
  for (const job of completed.jobs)
    for (const part of job.parts)
      expect(part.text).toBe(
        completed.blocks
          .find((b: any) => b.id === part.blockId)
          .normalizedText.slice(part.start, part.end),
      );
  await page.getByRole("button", { name: "全文摘要", exact: true }).click();
  await page.getByRole("button", { name: "生成摘要", exact: true }).click();
  await page
    .getByRole("button", { name: "確認並開始摘要", exact: true })
    .click();
  await expect(page.locator(".summary-text")).toContainText("主動連結");
  const json = JSON.parse((await getJSON(page)).text);
  expect(json.summaries).toHaveLength(1);
  expect(
    json.jobs
      .find((j: any) => j.kind === "summary")
      .chunks.every((c: any) => c.result && c.startPage >= 1 && c.endPage <= 2),
  ).toBe(true);
  await page.screenshot({ path: "test-results/summary-desktop.png" });
});
test("exports a verified researchpack, restores PDF and annotations without generation, and rejects corruption", async ({
  page,
}) => {
  let calls = 0;
  await page.route("https://api.openai.com/v1/**", (route) => {
    calls++;
    return route.fulfill({ json: generated });
  });
  await page.goto("./");
  await sample(page);
  await setup(page);
  await translateFirst(page);
  await page.getByRole("button", { name: "關閉翻譯備註" }).click();
  await page.getByRole("button", { name: "匯出研究", exact: true }).click();
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: /完整研究封裝/ }).click();
  const path = (await (await downloading).path())!;
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "清空本機研究", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "試讀範例文獻" }),
  ).toBeVisible();
  await page.getByTestId("restore-input").setInputFiles({
    name: "backup.researchpack",
    mimeType: "application/zip",
    buffer: await readFile(path),
  });
  await expect(
    page.getByRole("dialog", { name: "還原研究空間" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "確認取代並還原" }).click();
  await expect(page.locator(".translation-marker.translated")).toHaveCount(1);
  await page.locator(".translation-marker.translated").click();
  await expect(page.locator(".translated-text")).toContainText("主動連結");
  expect(calls).toBe(1);
  await page.getByRole("button", { name: "關閉翻譯備註" }).click();
  await page.getByTestId("restore-input").setInputFiles({
    name: "corrupt.researchpack",
    mimeType: "application/zip",
    buffer: Buffer.from("not a zip"),
  });
  await expect(page.getByRole("status")).toContainText("匯入失敗");
  expect(await page.locator(".translation-marker.translated").count()).toBe(1);
});
test("JSON restores text without PDF and matching reimport preserves saved block IDs", async ({
  page,
}) => {
  await page.route("https://api.openai.com/v1/**", (route) =>
    route.fulfill({ json: generated }),
  );
  await page.goto("./");
  await sample(page);
  await setup(page);
  await translateFirst(page);
  await page.getByRole("button", { name: "關閉翻譯備註" }).click();
  const json = await getJSON(page),
    id = JSON.parse(json.text).results[0].blockId;
  await page.getByTestId("restore-input").setInputFiles({
    name: "research.json",
    mimeType: "application/json",
    buffer: Buffer.from(json.text),
  });
  await page.getByRole("button", { name: "確認取代並還原" }).click();
  await expect(
    page.getByRole("heading", { name: "補回 PDF，接續閱讀" }),
  ).toBeVisible();
  await expect(page.locator(".text-results")).toContainText("主動連結");
  await page.getByTestId("pdf-input").setInputFiles("public/sample.pdf");
  await expect(page.locator(".pdf-page.ready").first()).toBeVisible();
  expect(await page.locator(`[data-marker="${id}"]`).count()).toBe(1);
  await expect(page.locator(".translation-marker.translated")).toHaveCount(1);
});
test("Grok model discovery and mobile layouts preserve the provider contract", async ({
  page,
}) => {
  const calls: any[] = [];
  await page.route("https://api.x.ai/v1/**", (route) => {
    calls.push({
      url: route.request().url(),
      body: route.request().postDataJSON(),
    });
    return route.fulfill({
      json:
        route.request().method() === "GET"
          ? {
              models: [
                {
                  id: "grok-text",
                  input_modalities: ["text"],
                  output_modalities: ["text"],
                },
                {
                  id: "image-only",
                  input_modalities: ["text"],
                  output_modalities: ["image"],
                },
              ],
            }
          : generated,
    });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("./");
  await page.screenshot({ path: "test-results/welcome-mobile.png" });
  await setup(page, "Grok（xAI）", "xai-private-secret");
  await page.getByRole("button", { name: "AI 已連接", exact: true }).click();
  await expect(page.getByLabel("推理程度")).toBeDisabled();
  await expect(page.getByLabel("模型 ID")).toHaveValue("grok-text");
  await expect(page.getByLabel("你的 API key", { exact: true })).toHaveValue(
    "",
  );
  expect(
    await page
      .getByRole("dialog")
      .evaluate((el) => el.scrollWidth <= el.clientWidth),
  ).toBe(true);
  await page.screenshot({ path: "test-results/settings-mobile.png" });
  await page.getByRole("button", { name: "完成", exact: true }).click();
  await sample(page);
  await translateFirst(page);
  expect(calls[0].url).toMatch(/language-models$/);
  expect(calls.at(-1).body).not.toHaveProperty("reasoning");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "test-results/reader-mobile.png" });
});
test("pauses an in-flight request and requires explicit resume after reload", async ({
  page,
}) => {
  let calls = 0;
  await page.route("https://api.openai.com/v1/**", async (route) => {
    calls++;
    await new Promise((r) => setTimeout(r, 600));
    await route.fulfill({ json: generated }).catch(() => {});
  });
  await page.goto("./");
  await sample(page);
  await setup(page);
  await page.getByRole("button", { name: "全文翻譯", exact: true }).click();
  await page
    .getByRole("button", { name: "確認並開始翻譯", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "暫停", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "暫停", exact: true }).click();
  await expect(page.getByRole("button", { name: /接續翻譯/ })).toBeVisible();
  const before = calls;
  await page.reload();
  await expect(page.getByRole("button", { name: /接續翻譯/ })).toBeVisible();
  expect(calls).toBe(before);
  const json = JSON.parse((await getJSON(page)).text);
  expect(json.jobs.at(-1).status).toBe("paused");
});
test("serializes generation across two windows", async ({ page, context }) => {
  let calls = 0;
  await context.route("https://api.openai.com/v1/**", async (route) => {
    calls++;
    await new Promise((r) => setTimeout(r, 1800));
    await route.fulfill({ json: generated }).catch(() => {});
  });
  await page.goto("./");
  await sample(page);
  await setup(page);
  const other = await context.newPage();
  await other.goto("./");
  await expect(other.locator(".translation-marker").first()).toBeVisible();
  await setup(other);
  await other.getByRole("button", { name: "全文翻譯", exact: true }).click();
  await page.locator(".translation-marker").first().click();
  await page.getByRole("button", { name: "翻譯此段", exact: true }).click();
  await expect.poll(() => calls).toBe(1);
  await other
    .getByRole("button", { name: "確認並開始翻譯", exact: true })
    .click();
  await expect(other.getByRole("status")).toContainText("另一個視窗");
  expect(calls).toBe(1);
  await page.getByRole("button", { name: "暫停", exact: true }).click();
});
test("reads stored documents offline from the GitHub Pages subpath", async ({
  page,
  context,
}) => {
  await page.goto("./");
  await sample(page);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const names = await caches.keys();
        return names.some((n) => n.includes("PaperTranslator"));
      }),
    )
    .toBe(true);
  await page.reload();
  await expect(page.locator(".pdf-page.ready").first()).toBeVisible();
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator(".pdf-page.ready").first()).toBeVisible();
  await expect(page.locator(".save-status")).toContainText("離線閱讀");
  await context.setOffline(false);
});
test("keeps successful translations when one request fails and resumes only missing work", async ({
  page,
}) => {
  let calls = 0;
  await page.route("https://api.openai.com/v1/**", (route) => {
    calls++;
    return calls === 2
      ? route.fulfill({
          status: 429,
          json: { error: { message: "private-provider-detail" } },
        })
      : route.fulfill({ json: generated });
  });
  await page.goto("./");
  await sample(page);
  await setup(page);
  await page.getByRole("button", { name: "全文翻譯", exact: true }).click();
  await page
    .getByRole("button", { name: "確認並開始翻譯", exact: true })
    .click();
  await expect(page.getByRole("button", { name: /接續翻譯/ })).toBeVisible({
    timeout: 30000,
  });
  const partial = JSON.parse((await getJSON(page)).text);
  expect(partial.jobs[0].status).toBe("partial");
  expect(partial.results.length).toBe(partial.jobs[0].blockIds.length - 1);
  const before = calls;
  await page.getByRole("button", { name: /接續翻譯/ }).click();
  await expect(page.getByRole("button", { name: /接續翻譯/ })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "全文翻譯", exact: true }),
  ).toBeEnabled();
  expect(calls).toBe(before + 1);
  const complete = JSON.parse((await getJSON(page)).text);
  expect(complete.jobs[0].status).toBe("complete");
  expect(complete.results.length).toBe(complete.jobs[0].blockIds.length);
});
test("retains a generated response as an exportable draft when IndexedDB runs out of space", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (
      value: unknown,
      ...args: unknown[]
    ) {
      const record = value as {
        data?: { jobs?: { parts?: { result?: unknown }[] }[] };
      };
      if (
        this.name === "research" &&
        record.data?.jobs?.some((j) => j.parts?.some((p) => p.result))
      )
        throw new DOMException(
          "Simulated quota exhaustion",
          "QuotaExceededError",
        );
      return original.call(this, value, ...(args as []));
    };
  });
  await page.route("https://api.openai.com/v1/**", (route) =>
    route.fulfill({ json: generated }),
  );
  await page.goto("./");
  await sample(page);
  await setup(page);
  await page.locator(".translation-marker").first().click();
  await page.getByRole("button", { name: "翻譯此段", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("保存失敗");
  await expect(page.locator(".translated-text")).toContainText("主動連結");
  const draft = JSON.parse((await getJSON(page)).text);
  expect(draft.jobs[0].status).toBe("paused");
  expect(draft.jobs[0].parts[0].result.text).toContain("主動連結");
});

test("aligns saved source geometry with actual PDF text after CropBox and native rotation", async ({
  page,
}) => {
  await page.goto("./");
  await page
    .getByTestId("pdf-input")
    .setInputFiles("tests/fixtures/cropped-rotated.pdf");
  await expect(page.locator(".pdf-page.ready")).toBeVisible();
  for (let i = 0; i < 2; i++) {
    await page
      .getByRole("button", { name: "段落 1 翻譯備註", exact: true })
      .click();
    const outline = await page
      .locator(".source-outline.focused")
      .first()
      .boundingBox();
    const source = await page.locator(".textLayer span").first().boundingBox();
    await page.screenshot({ path: `test-results/crop-${i}.png` });
    expect(outline).not.toBeNull();
    expect(source).not.toBeNull();
    expect(Math.abs(outline!.x - source!.x)).toBeLessThanOrEqual(2);
    expect(Math.abs(outline!.y - source!.y)).toBeLessThanOrEqual(2);
    await page.getByRole("button", { name: "旋轉 PDF" }).click();
    await expect(page.locator(".pdf-page.ready")).toBeVisible();
  }
});
