import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

async function sample(page: Page) {
  await page.goto("./");
  await page.getByRole("button", { name: "試讀範例文獻" }).click();
  await expect(page.locator(".pdf-page.ready").first()).toBeVisible();
  await expect(page.locator(".app-footer")).not.toContainText("正在辨識");
}
async function selectText(
  page: Page,
  text = "Reading is an active process",
  length = 25,
) {
  const span = page
    .locator(".textLayer span")
    .filter({ hasText: text })
    .first();
  await expect(span).toBeVisible();
  const quote = await span.evaluate((el, length) => {
    const node = el.firstChild!,
      range = document.createRange();
    range.setStart(node, 0);
    range.setEnd(node, Math.min(length, node.textContent!.length));
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    return range.toString();
  }, length);
  await expect(
    page.getByRole("toolbar", { name: "選取文字操作" }),
  ).toBeVisible();
  return quote;
}
async function json(page: Page) {
  await page.getByRole("button", { name: "匯出研究", exact: true }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: /JSON 研究資料/ }).click();
  return JSON.parse(await readFile((await (await download).path())!, "utf8"));
}
async function setup(page: Page) {
  await page.getByRole("button", { name: "AI 設定", exact: true }).click();
  await page
    .getByLabel("你的 API key", { exact: true })
    .fill("test-annotations-session-only");
  await page.getByRole("button", { name: "使用此金鑰", exact: true }).click();
  await page.getByRole("button", { name: "完成", exact: true }).click();
}
const response = (text: string) => ({
  status: "completed",
  output: [{ content: [{ type: "output_text", text }] }],
});

test("four highlight colors, editable sticky notes and positions survive rotation and pack restore", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await sample(page);
  for (const [name, color] of [
    ["黃色", "yellow"],
    ["淺綠", "green"],
    ["淺藍", "blue"],
    ["粉紅", "pink"],
  ]) {
    await page
      .getByRole("button", { name: `${name}螢光筆`, exact: true })
      .click();
    const line = page
      .locator(".textLayer span")
      .filter({ hasText: "Reading is an active process" })
      .first();
    const box = (await line.boundingBox())!;
    await page.mouse.move(box.x + 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2, {
      steps: 12,
    });
    await page.mouse.up();
    await expect(
      page.locator(`.manual-highlight.annotation-${color}`),
    ).toHaveCount(1);
  }
  await page.getByRole("button", { name: "螢光筆模式", exact: true }).click();
  await selectText(page);
  await page
    .getByRole("toolbar", { name: "選取文字操作" })
    .getByRole("button", { name: "便條貼", exact: true })
    .click();
  await page.getByLabel("便條貼內容").fill("這是重點，回查作者使用的證據。");
  await expect(page.locator(".note-save")).toContainText("已保存");
  await page
    .getByRole("button", { name: "標註顏色：粉紅", exact: true })
    .click();
  await page.getByRole("button", { name: "貼上便條貼", exact: true }).click();
  const bounds = (await page.locator(".pdf-page.ready").first().boundingBox())!;
  await page.mouse.click(bounds.x + 40, bounds.y + 80);
  await page.getByLabel("便條貼內容").fill("頁面便條：下次討論這個問題。");
  await expect(page.locator(".note-save")).toContainText("已保存");
  const original = await json(page);
  expect(original.schemaVersion).toBe(2);
  expect(original.annotations).toHaveLength(6);
  expect(
    original.annotations
      .filter((a: any) => a.kind === "highlight")
      .map((a: any) => a.color),
  ).toEqual(["yellow", "green", "blue", "pink"]);
  await page.getByRole("button", { name: "關閉標註側欄", exact: true }).click();
  await page.getByRole("button", { name: "旋轉 PDF", exact: true }).click();
  await expect(page.locator(".pdf-page.ready").first()).toBeVisible();
  expect((await json(page)).annotations.map((a: any) => a.anchors)).toEqual(
    original.annotations.map((a: any) => a.anchors),
  );
  await page.getByRole("button", { name: "匯出研究", exact: true }).click();
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: /完整研究封裝/ }).click();
  const pack = await readFile((await (await downloading).path())!);
  await page.getByTestId("restore-input").setInputFiles({
    name: "annotations.researchpack",
    mimeType: "application/zip",
    buffer: pack,
  });
  await page.getByRole("button", { name: "確認取代並還原" }).click();
  await expect(page.locator(".pdf-page.ready").first()).toBeVisible();
  await page.getByRole("button", { name: "開啟我的標註", exact: true }).click();
  await expect(page.locator(".annotation-card")).toHaveCount(6);
  await expect(page.locator(".annotations-panel")).toContainText(
    "這是重點，回查作者使用的證據。",
  );
  await expect(page.locator(".annotations-panel")).toContainText(
    "頁面便條：下次討論這個問題。",
  );
  page.once("dialog", (d) => d.accept());
  await page
    .locator(".annotation-card")
    .first()
    .getByRole("button", { name: "刪除標註", exact: true })
    .click();
  await expect(page.locator(".annotation-card")).toHaveCount(5);
  await page.reload();
  await page.getByRole("button", { name: "開啟我的標註", exact: true }).click();
  await expect(page.locator(".annotation-card")).toHaveCount(5);
  expect(errors).toEqual([]);
});

test("selected text AI translation and summary send only the quote and keep result history", async ({
  page,
}) => {
  const requests: any[] = [];
  await page.route("https://api.openai.com/v1/**", (route) => {
    requests.push(route.request().postDataJSON());
    return route.fulfill({
      json: response(`選取文字的結果 ${requests.length}，保留 42 mg [1]。`),
    });
  });
  await sample(page);
  await setup(page);
  const quote = await selectText(page);
  expect(requests).toHaveLength(0);
  await page.getByRole("button", { name: "AI 翻譯", exact: true }).click();
  await expect(page.locator(".annotation-result")).toContainText("結果 1");
  expect(
    requests[0].input
      .split("<research_source>\n")[1]
      .split("\n</research_source>")[0],
  ).toBe(quote);
  await selectText(page, "Translation can reduce", 30);
  await page.getByRole("button", { name: "AI 摘要", exact: true }).click();
  await expect(page.locator(".annotation-result").last()).toContainText(
    "結果 2",
  );
  const translation = page
    .locator(".annotation-card")
    .filter({ hasText: "選取翻譯" });
  await translation
    .getByRole("button", { name: "重新生成", exact: true })
    .click();
  await expect(translation.locator(".annotation-result")).toContainText(
    "結果 3",
  );
  const data = await json(page);
  expect(
    data.annotations.find((a: any) => a.kind === "translation").results,
  ).toHaveLength(2);
  expect(
    data.annotations.find((a: any) => a.kind === "summary").results,
  ).toHaveLength(1);
  expect(JSON.stringify(data)).not.toContain("test-annotations-session-only");
  expect(requests).toHaveLength(3);
  await page.screenshot({ path: "test-results/annotations-desktop.png" });
  await page.reload();
  await page.getByRole("button", { name: "開啟我的標註", exact: true }).click();
  await expect(page.locator(".annotation-result").first()).toContainText(
    "結果 3",
  );
});

test("selection annotations preserve generated output when IndexedDB quota is exhausted", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value: any, ...args: any[]) {
      if (
        this.name === "research" &&
        value.data?.annotations?.some((a: any) => a.results.length)
      )
        throw new DOMException("Simulated quota", "QuotaExceededError");
      return original.call(this, value, ...(args as []));
    };
  });
  await page.route("https://api.openai.com/v1/**", (route) =>
    route.fulfill({ json: response("保存這份生成草稿 42 mg") }),
  );
  await sample(page);
  await setup(page);
  await selectText(page);
  await page.getByRole("button", { name: "AI 摘要", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("保存失敗");
  await expect(page.locator(".annotation-result")).toContainText(
    "保存這份生成草稿",
  );
  const data = await json(page);
  expect(data.annotations[0].results[0].text).toContain("保存這份生成草稿");
  expect(data.annotations[0].status).toBe("paused");
});

test("mobile selection actions create notes and colored highlights", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await sample(page);
  await selectText(page);
  await page
    .getByRole("button", { name: "以淺藍標記選取文字", exact: true })
    .click();
  await expect(page.locator(".manual-highlight.annotation-blue")).toHaveCount(
    1,
  );
  await selectText(page);
  await page
    .getByRole("toolbar", { name: "選取文字操作" })
    .getByRole("button", { name: "便條貼", exact: true })
    .click();
  await page.getByLabel("便條貼內容").fill("手機上的閱讀筆記");
  await expect(page.locator(".note-save")).toContainText("已保存");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "test-results/annotations-mobile.png" });
});
test("selection AI shares the generation lock and remains paused after reload", async ({
  page,
  context,
}) => {
  let calls = 0,
    release: (() => Promise<void>) | undefined;
  await context.route("https://api.openai.com/v1/**", (route) => {
    calls++;
    if (calls !== 1)
      return route.fulfill({ json: response("重試後的選取摘要") });
    return new Promise<void>((resolve) => {
      release = async () => {
        try {
          await route.fulfill({ json: response("較晚抵達的回應") });
        } catch {
          /* The paused request was aborted. */
        }
        resolve();
      };
    });
  });
  await sample(page);
  await setup(page);
  await selectText(page);
  await page.getByRole("button", { name: "AI 摘要", exact: true }).click();
  await expect(
    page
      .locator(".annotation-card")
      .getByRole("button", { name: "暫停", exact: true }),
  ).toBeVisible();
  await expect.poll(() => calls).toBe(1);
  const second = await context.newPage();
  await second.goto("./");
  await expect(second.locator(".pdf-page.ready").first()).toBeVisible();
  await setup(second);
  await selectText(second);
  await second.getByRole("button", { name: "AI 翻譯", exact: true }).click();
  await expect(
    second.getByRole("status").filter({ hasText: "另一個視窗" }),
  ).toBeVisible();
  expect(calls).toBe(1);
  await second.close();
  await page
    .locator(".annotation-card")
    .first()
    .getByRole("button", { name: "暫停", exact: true })
    .click();
  await expect(
    page
      .locator(".annotation-card")
      .first()
      .getByRole("button", { name: "重試生成", exact: true }),
  ).toBeVisible();
  await release!();
  await page.reload();
  await page.getByRole("button", { name: "開啟我的標註", exact: true }).click();
  await expect(
    page
      .locator(".annotation-card")
      .first()
      .getByRole("button", { name: "重試生成", exact: true }),
  ).toBeVisible();
  expect(calls).toBe(1);
  await setup(page);
  await page
    .locator(".annotation-card")
    .first()
    .getByRole("button", { name: "重試生成", exact: true })
    .click();
  await expect(page.locator(".annotation-result")).toContainText(
    "重試後的選取摘要",
  );
  expect(calls).toBe(2);
});
test("manual highlights track selected text through CropBox and every native rotation", async ({
  page,
}) => {
  await page.goto("./");
  await page
    .getByTestId("pdf-input")
    .setInputFiles("tests/fixtures/cropped-rotated.pdf");
  await expect(page.locator(".pdf-page.ready")).toBeVisible();
  await selectText(page, "CropBox and rotation fixture", 1000);
  await page
    .getByRole("button", { name: "以淺藍標記選取文字", exact: true })
    .click();
  await expect(page.locator(".manual-highlight")).toHaveCount(1);
  for (let i = 0; i < 4; i++) {
    const text = await page
      .locator(".textLayer span")
      .first()
      .evaluate((el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        const box = range.getBoundingClientRect();
        return { x: box.x, y: box.y, width: box.width, height: box.height };
      });
    const mark = (await page.locator(".manual-highlight").boundingBox())!;
    for (const key of ["x", "y", "width", "height"] as const)
      expect(Math.abs(mark[key] - text[key])).toBeLessThanOrEqual(2);
    await page.getByRole("button", { name: "旋轉 PDF", exact: true }).click();
    await expect(page.locator(".pdf-page.ready")).toBeVisible();
  }
});
