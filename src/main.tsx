import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App";
import { toast } from "./lib/storage";
import "./styles.css";
registerSW({
  onNeedRefresh() {
    toast(
      "新版本已備妥。請在目前任務完成並備份後，關閉所有此網站分頁再重新開啟。",
    );
  },
  onOfflineReady() {
    toast("離線閱讀已準備好。已保存的 PDF、譯文與摘要可離線使用。");
  },
});
createRoot(document.getElementById("root")!).render(<App />);
