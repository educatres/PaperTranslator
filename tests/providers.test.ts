import { beforeEach, afterEach, expect, it, vi } from "vitest";
vi.stubGlobal("window", new EventTarget());
vi.stubGlobal("location", { origin: "https://educatres.github.io" });
const { generate, listModels, setKey, clearAllKeys, hasKey } =
  await import("../src/lib/providers");
beforeEach(() => clearAllKeys());
afterEach(() => vi.unstubAllGlobals());
const response = (text = "翻譯結果 42 mg [1]") => ({
  status: "completed",
  output: [{ content: [{ type: "output_text", text }] }],
  usage: { total_tokens: 42 },
});
it("normalizes CGU keys and sends Responses with explicit privacy and effort", async () => {
  setKey("cgu", "Authorization: Bearer test-session-only");
  const fetch = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify(response())));
  vi.stubGlobal("fetch", fetch);
  const r = await generate(
    "cgu",
    "gpt-6-luna",
    "translate",
    "Evidence 42 mg [1]",
    undefined,
    "high",
  );
  const [url, options] = fetch.mock.calls[0];
  expect(url).toBe("https://air.cgu.edu.tw/cgullmapi/v1/responses");
  expect(options.headers.Authorization).toBe("Bearer test-session-only");
  expect(options).toMatchObject({
    credentials: "omit",
    cache: "no-store",
    referrerPolicy: "no-referrer",
  });
  expect(JSON.parse(options.body)).toMatchObject({
    store: false,
    reasoning: { effort: "high" },
  });
  expect(r.usage).toBe(42);
});
it("Grok filters language modalities and omits unused reasoning", async () => {
  setKey("grok", "xai-secret");
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          models: [
            {
              id: "grok-text",
              input_modalities: ["text"],
              output_modalities: ["text"],
            },
            {
              id: "grok-image",
              input_modalities: ["text"],
              output_modalities: ["image"],
            },
          ],
        }),
      ),
    )
    .mockResolvedValueOnce(new Response(JSON.stringify(response())));
  vi.stubGlobal("fetch", fetch);
  expect((await listModels("grok")).map((m) => m.id)).toEqual(["grok-text"]);
  const r = await generate("grok", "grok-text", "translate", "Source");
  expect(fetch.mock.calls[0][0]).toMatch(/\/language-models$/);
  expect(JSON.parse(fetch.mock.calls[1][1].body)).not.toHaveProperty(
    "reasoning",
  );
  expect(r).not.toHaveProperty("reasoningEffort");
});
it("Gemini paginates, filters and uses x-goog-api-key", async () => {
  setKey("gemini", "gemini-secret");
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          models: [
            {
              name: "models/gemini-text",
              supportedGenerationMethods: ["generateContent"],
            },
            {
              name: "models/embed",
              supportedGenerationMethods: ["embedContent"],
            },
          ],
          nextPageToken: "next",
        }),
      ),
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          models: [
            {
              name: "models/gemini-flash-lite-latest",
              supportedGenerationMethods: ["generateContent"],
            },
          ],
        }),
      ),
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          candidates: [
            {
              finishReason: "STOP",
              content: {
                parts: [
                  { thought: true, text: "private reasoning" },
                  { text: "結果" },
                ],
              },
            },
          ],
        }),
      ),
    );
  vi.stubGlobal("fetch", fetch);
  expect(await listModels("gemini")).toHaveLength(2);
  expect(fetch.mock.calls[1][0]).toContain("pageToken=next");
  const r = await generate("gemini", "gemini-text", "translate", "Evidence");
  expect(r.text).toBe("結果");
  const options = fetch.mock.calls[2][1];
  expect(options.headers["x-goog-api-key"]).toBe("gemini-secret");
  expect(options.headers).not.toHaveProperty("Authorization");
  expect(JSON.parse(options.body)).not.toHaveProperty("reasoning");
});
it.each([401, 403, 404, 429, 500])(
  "redacts provider error content for HTTP %i",
  async (status) => {
    setKey("openai", "secret-key");
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response("secret-key private research", { status }),
        ),
    );
    await expect(
      generate("openai", "test", "translate", "Evidence"),
    ).rejects.not.toThrow(/secret-key|private research/);
  },
);
it("rejects empty and incomplete Responses", async () => {
  setKey("openai", "secret");
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(response(""))))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ...response(), status: "incomplete" })),
      ),
  );
  await expect(generate("openai", "test", "t", "s")).rejects.toThrow(
    "可用文字",
  );
  await expect(generate("openai", "test", "t", "s")).rejects.toThrow(
    "未能完成",
  );
});
it("isolates credentials by provider and clears them on pagehide", () => {
  setKey("openai", "one");
  setKey("cgu", "two");
  expect(hasKey("grok")).toBe(false);
  setKey("cgu", "");
  expect(hasKey("openai")).toBe(true);
  clearAllKeys();
  expect(hasKey("openai")).toBe(false);
});
