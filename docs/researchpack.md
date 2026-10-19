# PaperTranslator 研究封裝 v1

應用識別：`educatres.PaperTranslator`。版本：`schemaVersion: 1`。純文字使用 UTF-8，PDF 保持原始 bytes。

```text
研究名稱.researchpack
├── manifest.json
├── research.json
└── documents/
    └── <documentId>.pdf
```

manifest 包含 `appId`、`schemaVersion`、`title`、`exportedAt`、`research: {path, size, sha256}` 及 `documents: [{documentId, path, size, sha256}]`。

research.json 通過 `src/types.ts` 的嚴格 Zod schema，包含 `id`、`epoch`、`revision`、`updatedAt`、`documents`、`pages`、`blocks`、`results`、`summaries` 及 `jobs`。不接受未宣告欄位，沒有憑證欄位。

文件以原始 PDF SHA-256 識別。段落識別碼為以下 UTF-8 字串的 SHA-256：

```text
<documentSha256>:<layoutVersion>:<zeroBasedPageIndex>:<regionId>:<columnId>:<itemIndex>:<start>:<end>|...
```

來源範圍依段落行及行內 item 排序。另以正規化原文 SHA-256 作 `sourceHash`。頁面保存未旋轉的可見頁面尺寸、PDF CropBox、原生旋轉及 PDF.js viewport transform。行框以未旋轉可見頁面左上角為原點，保存 0–1 正規化四角座標。當前螢幕像素不會寫入研究資料。

結果的 `currentResultId` 與文件的 `currentSummaryId` 是明確的有效版本參照。所有成功歷史版本保留。任務保存設定快照、文件 hash、layoutVersion、段落 ID、完整且無重疊的子片段來源及每個成功子結果。摘要另外保存原文 chunks、原始頁碼及分層整合節點。

匯出取得同一 IndexedDB 唯讀交易中的研究與原檔快照，只把副本的執行狀態改為 paused，不影響正在執行的任務。JSON 與研究封裝匯入都完整驗證型別、識別碼、hash、參照、來源字元範圍、結果及狀態。ZIP 在 JSZip 正規化路徑之前檢查原始 central directory，拒絕穿越、絕對路徑、重複名稱、加密、ZIP64、多卷與超限；解壓時再以實際累加長度限制，PDF 驗證原始 hash、大小與頁數。

還原前顯示預覽與取代警告。確認後取得與生成共用的 Navigator Lock，產生新 epoch，以單一 IndexedDB 交易取代研究與原檔；失敗會回滾。未完成任務還原為 paused。JSON 沒有原檔，仍可讀文字結果；補回同 hash PDF 不重新切段或呼叫 AI。

PaperReader 的 appId/schema 與本格式不同。首版明確拒絕舊封裝，不靜默遺失白板便條或關係。
