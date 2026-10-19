# PaperTranslator

逐段讀懂英文論文。保留原始 PDF 版面，透過段旁備註閱讀繁體中文譯文，並以全文摘要回看研究全貌。

介面參考 [PaperReader](https://github.com/educatres/PaperReader) 的森林綠、暖白色與閱讀工具列。這是獨立應用，沒有白板相依，資料與快取不會共用。

## 開始使用

1. 匯入或拖放 PDF，也可點「試讀範例文獻」。
2. 開啟「AI 設定」，選供應商、貼上自己的金鑰、選擇模型並測試連線。
3. 點段落旁的圖示，再按「翻譯此段」；或確認範圍後啟動全文逐段翻譯。
4. 已完成譯文可滑鼠預覽、固定展開、複製與定位原文。任務可暫停，重開後按「接續」繼續。
5. 開啟全文摘要側欄，可獨立以英文原文生成有來源頁碼的摘要。
6. 定期下載完整 `.researchpack`，可在其他裝置還原。

無金鑰也能閱讀、搜尋、查看既有結果及匯入／匯出。匯入、捲動、滑鼠預覽與開啟既有譯文不會呼叫 AI。

## 開發

需要 Node.js 24 以上與 npm。

```sh
npm ci
npm run dev
```

```sh
npm test
npm run build
npx playwright install chromium firefox
npm run test:e2e
```

Windows 本機瀏覽器測試預設使用 Edge；Linux／macOS 與 CI 使用 Playwright Chromium、Firefox。Windows 可設定 `PAPERTRANSLATOR_FIREFOX=1` 額外執行 Firefox（需要可啟動的 Playwright Firefox 執行環境）。測試伺服器將成品掛在 `/PaperTranslator/`，驗證 GitHub Pages 子路徑、PDF 本機資源及 PWA。`node scripts/create-fixtures.mjs` 可重新產生自製的雙欄範例與旋轉／裁切測試 PDF。所有測試使用攔截回應，不需要真實 API 金鑰或費用。

## 功能與資料

- 多 PDF 文獻庫、SHA-256 去重與缺檔補回；連續頁面、選字、手掌、縮放、適合寬度、旋轉及段落文字搜尋。
- 依 PDF.js TextItem 的位置重建文字行，再依行距、縮排、字型與版面留白形成段落。全寬標題可與下方雙欄分開；一段只屬於一頁、一個區域及一欄。
- 保存來源 item／字元範圍、行四角座標、頁面 CropBox／轉換及原生旋轉。縮放或重開使用保存的識別碼，不自動重切原文。
- 長段落按句界分成最多 6,000 字元的內部子片段，完整保存後才形成一個譯文。成功版本保留，失敗可接續。
- 摘要按約 6,500 字元分塊、保存局部結果，再分層整合；頁碼代表來源分塊範圍，仍須人工回查。
- IndexedDB 交易保存結果與任務進度；Navigator Locks 讓翻譯、摘要及研究還原互斥，BroadcastChannel 通知其他視窗重新讀取資料。
- 每個閱讀視窗的文件、頁碼、縮放與旋轉存在自己的 sessionStorage。重新整理不會自動接續 AI 任務。
- 首次完成 PWA 快取後，可離線重開並閱讀已保存的 PDF、譯文與摘要；AI 需要網路。PDF worker、CMap、字型與 WASM 都隨網站提供。

### API 供應商

| 供應商 | Base URL | 模型查詢 | 文字生成 |
| --- | --- | --- | --- |
| OpenAI | `https://api.openai.com/v1` | `/models` | Responses，`store: false`，低／中／高推理 |
| CGU | `https://air.cgu.edu.tw/cgullmapi/v1` | `/models` | 同上；接受 Bearer 前綴金鑰 |
| mercuryapi | `https://air.cgu.edu.tw/mercuryapi/v1` | `/models` | 同上；使用金鑰後自動取得模型 |
| Google Gemini | `https://generativelanguage.googleapis.com/v1beta` | 分頁 `/models`，限 generateContent | generateContent，`x-goog-api-key` |
| Grok（xAI） | `https://api.x.ai/v1` | `/language-models`，限文字輸入與輸出 | Responses，`store: false`，模型預設推理 |

連線層依 PaperReader 已提交版本 `7718ad9` 移植並以模擬回應驗證。模型清單不等於文字生成權限；請使用「測試連線」。保留 `gpt-6-luna`、`gpt-5.6-luna` 產品選項與自訂 ID，實際可用模型依帳戶權限。單次請求逾時 120 秒，不自動切換 API 或模型。

金鑰只存在目前分頁的記憶體 Map，重新整理／pagehide 後清除，不進任何儲存區、研究資料或匯出檔。網站沒有後端、帳號、追蹤或雲端資料庫。使用者確認 AI 任務後，由瀏覽器直接以 HTTPS 連到所選供應商。

### 備份格式

| 格式 | 內容 | 可還原 |
| --- | --- | --- |
| `.researchpack` | manifest、研究 JSON、所有原始 PDF | 完整還原 |
| `.json` | 原文、位置、譯文版本、摘要與任務 | 可還原文字，PDF 需按相同 SHA-256 補回 |
| `.md` | 依文獻、頁碼、欄位排序的中英對照與摘要 | 閱讀／分享用途 |

研究封裝 schema 詳見 [docs/researchpack.md](docs/researchpack.md)。單份 PDF 上限 150 MB、每份研究最多 50 PDF、封裝壓縮 200 MB、實際解壓總量 300 MB、JSON 30 MB、ZIP entries 10,200。匯入先在記憶體中驗證，預覽後確認取代；驗證失敗不改動原有資料。

### 限制

版面辨識是幾何啟發式，尚未以大規模人工標註論文量測準確率。複雜表格、公式、旋轉文字與密集混排可能需要人工回查；待檢查片段不自動加入全文翻譯。沒有文字層的頁面提示需要 OCR。完成全文翻譯只代表所選可翻譯片段完成。

首版未實作規格 P1：人工拆併段落、人工修訂譯文／術語表、原生 PDF 中文註解匯出及舊 PaperReader 封裝遷移。原始 PDF 不會被改寫。瀏覽器清除網站資料會移除研究，請定期備份；各瀏覽器與 localhost 的資料彼此獨立。瀏覽器或供應商的 CORS／模型權限仍可能限制真實連線，真實付費 API 未納入自動化測試。

## 部署

推送到 `main` 後，GitHub Actions 執行型別檢查、單元測試、正式建置與瀏覽器測試，再部署 GitHub Pages。儲存庫 Settings → Pages 的來源應為 GitHub Actions。網站使用相對資源路徑，可放在 `/PaperTranslator/`。

## 專案結構

```text
src/components/    PDF 閱讀器、段落備註、AI 設定與對話框
src/lib/layout.ts  幾何分區、欄位、文字行與段落辨識
src/lib/tasks.ts   翻譯子片段、摘要分塊、互斥與接續
src/lib/providers.ts 記憶體金鑰與五家 API adapter
src/lib/storage.ts IndexedDB 交易、epoch 與跨視窗通知
src/lib/transfer.ts 研究封裝、校驗與資料不變條件
tests/             人工定義版面樣本、API／資料測試與瀏覽器驗收
```

原始需求見 [系統規格書](PDF_逐段翻譯閱讀器_系統規格書_v1.0.md)。範例 PDF 為專案自製示範文字，不是發表論文。第三方授權文字會在建置時複製到 `public/licenses/`，並隨網站提供。
