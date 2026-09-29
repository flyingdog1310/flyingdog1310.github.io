# 翻新路線圖（ROADMAP）

技術細節與問題編號（H1、S1…）請對照 [IMPLEMENTATION.md](./IMPLEMENTATION.md)。

排序原則：**先保護正在使用的功能（股票頁）→ 再處理效益最大的效能問題（首頁）→ 建立共用基礎 → 逐款翻新遊戲**。每個 Phase 都可以獨立上線。

---

## Phase 0 — 準備與基準線

- [ ] 刪除本機空資料夾 `games/super_mario/`
- [ ] 對首頁跑 Lighthouse（Mobile），記錄 LCP / TBT / 傳輸量 / 請求數作為基準
- [ ] 對股票頁截圖（桌機 + 375px 手機），作為視覺比對基準
- [ ] 確認 IMPLEMENTATION §5 的決策項目

**完成條件**：基準數據記錄在 PR 或本文件底部的「基準紀錄」。

---

## Phase 1 — 股票頁 ⭐ 最優先

> 股票頁是實際在用的功能。每一步都要通過 golden test，並在本機與 Google Sheet 直接對表比對數字。IMPLEMENTATION §3.1 列出的行為（含**漲紅跌綠**）一律不變。

### 1a. 安全網（純重構，行為零變化）

- [x] 抽出純函式到 `stock/lib.js`（ES module），`script.js` 只留 DOM 操作
- [x] 刪除重複的 `parseCSVLine`（S2）
- [x] 從真實 Sheet 抓 CSV 快照當 fixture（真實資料，不去識別化）
- [x] `node --test` golden test：fixture → 顯示資料，期望值直接對照 Google Sheet

> 測試方式：`npm test`。golden 由重構前的 script.js（`64a88b7`）在假 DOM 裡執行產生，新版必須輸出完全相同。
> 更新真實資料：`npm run stock:fixtures`，接著 `npm run stock:golden` 重新產生期望值。
> 1b 起若有「刻意的」行為改變，golden 改由當下已驗證的版本產生，並在 commit 說明差異。

**完成條件**：測試通過；本機開頁面，每個數字與 Google Sheet 逐欄對照一致。

### 1b. 效能與穩定性

- [x] 兩個 Sheet 請求並行（S1）— 剩餘資金的請求本來就不會拋錯，所以用 `Promise.all` 即可，語意與 `allSettled` 相同
- [x] CSV parser 支援 `\r\n` 與引號內換行（S3），補對應測試
- [x] 刷新按鈕 loading / disabled、`AbortController` 取消舊請求（S6）
- [x] localStorage 快取上次結果，開頁先顯示快取再背景更新
- [x] 表格改用 `textContent` 建立（S7）

> golden 仍由 `64a88b7` 產生：測試工具把新舊版的表格都轉成「每格文字 + class」再比對，所以改用 `textContent` 後，比對基準仍是重構前的原始版本。

**完成條件**：首次載入時間約為原本的一半（兩個請求並行）；連點刷新不會出現錯亂資料；快取不可用（無痕模式）時行為與舊版相同。

### 1c. UI / 視覺

- [ ] 刷新時保留內容 + skeleton，不再整頁閃爍（S4）
- [ ] 錯誤時保留舊資料並標示資料時間 + 重試按鈕（S5）
- [ ] 摘要卡新增：總成本、總未實現損益（金額 / %）、總資產（S9）
- [ ] 手機版改卡片列表（S8）
- [ ] 數字 `tabular-nums`、靠右對齊；欄位排序
- [ ] （選配）交易時段自動刷新，預設關閉

**完成條件**：既有欄位數字不變；新摘要數字有單元測試；375px 寬無橫向捲動。

---

## Phase 2 — 首頁效能

- [ ] 縮圖產生腳本 `scripts/capture-thumbs`（headless Chrome），產出 21 張 `thumb.webp`
- [ ] `games.json` 加入 `thumbnail`；卡片改 `<img loading="lazy">`，移除預覽 iframe（H1）
- [ ] 移除 Font Awesome，改 inline SVG（H2）
- [ ] 移除訪客 IP / 國旗（H3，依決策）
- [ ] 處理 `deployment-info.json`：加 Actions workflow 或移除（H4，依決策）

**完成條件**：首頁不再有任何 iframe 在背景執行；Lighthouse Mobile 效能分數與傳輸量相比 Phase 0 基準有明顯改善（目標：請求數 < 30、無第三方請求、TBT < 200ms）。

---

## Phase 3 — 共用設計系統

- [ ] 建立 `shared/tokens.css`、`shared/base.css`
- [ ] 首頁與股票頁改用 tokens（視覺等價替換，股票頁再跑一次比對）
- [ ] 建立 `shared/game-shell.css`、`shared/game-utils.js`（DPR、loop、自動暫停、最高分、輸入）
- [ ] 為 `game-utils.js` 的純邏輯寫 `node --test`

**完成條件**：三個主要頁面引用同一份 tokens；換色只需要改 `tokens.css`。

---

## Phase 4 — 首頁 UI / 視覺

- [ ] 篩選合併為 `applyFilters`，修正分類忽略搜尋字串的 bug（U1）
- [ ] 篩選狀態同步到 URL
- [ ] Empty state（U2）
- [ ] 卡片可鍵盤操作、可在新分頁開啟（U3）
- [ ] Modal 改 `<dialog>`、Esc 關閉、焦點回復、`#play=<id>` 深連結（U4）
- [ ] Event delegation（U5）
- [ ] 視覺：字體層級、間距、卡片 elevation / hover、分類 chip、`prefers-reduced-motion`（U6）

**完成條件**：只用鍵盤可以完成「搜尋 → 開遊戲 → 關閉 → 回到原卡片」；分享 `#play=tetris` 連結可以直接開啟遊戲。

---

## Phase 5 — 遊戲逐款翻新

依效益排序，每款一個 PR。

| 批次 | 遊戲 | 重點 |
|------|------|------|
| 5a Canvas 動作類 | tetris、snake、breakout、space_invaders、raiden_fighters、dino_runner、tank_battle | DPR 清晰度、fixed-timestep loop、自動暫停、觸控、最高分；tank_battle 移除 `setInterval` loop |
| 5b 益智類 | 2048、minesweeper、sudoku、wordle、memory_match、bulls_and_cows | 套 game-shell、鍵盤操作、最高分/最佳時間、ARIA |
| 5c 棋盤類 | chess、chinese_chess、checkers、reversi、gomoku、connect_four、tic_tac_toe | 棋盤 RWD、可選取狀態與合法步提示的視覺、ARIA |
| 5d 卡牌 | solitaire | 拖曳改 Pointer Events（同時支援滑鼠與觸控）、動畫 |

### 遊戲驗收清單（每款都要過）

- [ ] 顏色全部改用 `shared/tokens.css`
- [ ] Canvas 遊戲在 Retina / 手機上清晰
- [ ] 120Hz 螢幕上遊戲速度正常
- [ ] 切換分頁 / 關閉 modal 後自動暫停，不在背景耗 CPU
- [ ] 手機可用觸控完整遊玩
- [ ] 有最高分或最佳紀錄（適用時）
- [ ] 有 Game Over / 勝利畫面與「再玩一次」
- [ ] 基本 ARIA 與鍵盤操作
- [ ] 手動遊玩一輪：開始 → 得分 → 結束 → 重玩

---

## Phase 6 — 收尾

- [ ] 更新 `README.md`、`AI_GUIDE.md`（改成引用 `shared/`）
- [ ] 最後一次 Lighthouse，與 Phase 0 基準對照
- [ ] （選配）GitHub Actions：`prettier --check` + `node --test`

---

## 基準紀錄

| 指標 | Phase 0 | Phase 2 後 | Phase 6 後 |
|------|---------|------------|------------|
| Lighthouse Performance (Mobile) | | | |
| LCP | | | |
| TBT | | | |
| 請求數 | | | |
| 傳輸量 | | | |
