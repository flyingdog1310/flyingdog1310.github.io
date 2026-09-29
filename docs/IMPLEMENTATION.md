# 翻新實作說明（IMPLEMENTATION）

本文件記錄 repo 現況盤點、翻新的技術決策與各區塊的實作規範。排程與里程碑請見 [ROADMAP.md](./ROADMAP.md)。

---

## 1. 現況盤點

### 1.1 架構

- 純靜態網站，部署在 GitHub Pages，無 build step、無相依套件。
- 首頁：`index.html` + `main.js` + `styles.css`，從 `games.json` 讀取遊戲清單後渲染卡片，點擊開 modal（iframe）遊玩。
- 遊戲：`games/<name>/` 各自獨立（`index.html` / `script.js` / `style.css`），共 21 款。
- 股票頁：`stock/`，從公開 Google Sheet（gviz CSV 端點）讀取持股資料。**實際在使用中，是本次翻新優先級最高、風險最高的部分。**

### 1.2 主要問題

#### 首頁（效能）

| # | 問題 | 位置 | 影響 |
|---|------|------|------|
| H1 | 每張卡片的預覽都是**一個即時執行遊戲的 iframe**，21 個 iframe 同時載入、同時跑 rAF loop | `main.js` `renderGameCards()` | 首頁載入慢、CPU/電量持續消耗、手機發燙；這是最大的效能問題 |
| H2 | 整包 Font Awesome CSS + webfont 只為了 2 個 icon | `index.html` | 多一個阻塞渲染的外部請求 |
| H3 | 每次載入都打 `api.ipify.org` + `ipapi.co` 兩個第三方 API 顯示訪客 IP / 國旗 | `main.js` `getVisitorIP()` | 額外網路請求、ipapi.co 常被 rate limit (429)、隱私疑慮 |
| H4 | `deployment-info.json` 不存在，每次都 404 | `main.js` 最下方 | 無效請求，畫面永遠顯示 `Unknown` |
| H5 | 預覽 iframe 取得焦點/鍵盤事件、音效等副作用不可控 | 同 H1 | — |

#### 首頁（UI / 功能 bug）

| # | 問題 | 位置 |
|---|------|------|
| U1 | 切換分類時會忽略目前的搜尋字串（分類與搜尋沒有共用同一個 filter 函式） | `initializeFilteringAndSearch()` |
| U2 | 搜尋無結果時沒有 empty state | 同上 |
| U3 | 卡片是 `div`，無法用鍵盤 Tab / Enter 開啟 | `renderGameCards()` |
| U4 | Modal 沒有 Esc 關閉、沒有 focus trap、關閉後焦點不會回到卡片、無法用網址直接開某款遊戲 | modal 相關程式 |
| U5 | 每次 render 都重新綁定 listener，沒有用 event delegation | `attachModalListeners()` |
| U6 | 視覺上層次偏平：卡片、側欄、按鈕只有單一灰階，沒有字體/間距系統 | `styles.css` |

#### 遊戲（共通問題）

以 grep 盤點的結果：

| 項目 | 現況 |
|------|------|
| Canvas 的 `devicePixelRatio` 縮放 | 0 / 8 款 canvas 遊戲有處理 → Retina / 手機螢幕畫面模糊 |
| 分頁切到背景時暫停（`visibilitychange`） | 0 / 21 |
| 觸控操作 | 僅 2048、breakout、dino_runner 有 |
| 最高分保存（localStorage） | 僅 2048、dino_runner 有 |
| ARIA / 無障礙 | 僅 breakout 有 |
| 使用 `setInterval` 當遊戲 loop | tank_battle（其餘 canvas 遊戲已用 rAF） |
| 主題色 | 各自在 `style.css` 寫死色碼，只有 15 款用到 `#121213`，不一致 |

其他：`games/super_mario/` 是本機殘留的空資料夾（未進 git），可刪除。

#### 股票頁

| # | 問題 | 位置 |
|---|------|------|
| S1 | 兩個 Sheet 請求是**串行**的（`await` 完一個才發下一個），載入時間 = 兩者相加 | `loadAndDisplayData()` |
| S2 | `parseCSVLine` 重複定義兩份 | `script.js` |
| S3 | CSV 用 `split('\n')` 切行，儲存格內含換行或 `\r\n` 時會解析錯 | `parseCSV()` |
| S4 | 每次刷新都先把整個內容藏起來只顯示 spinner，畫面閃爍 | `loadAndDisplayData()` |
| S5 | 刷新失敗時，舊資料和錯誤訊息混在一起顯示，看不出資料是舊的 | catch 區塊 |
| S6 | 刷新按鈕沒有 loading 狀態，連點會同時發多組請求、後回來的覆蓋先回來的 | refresh listener |
| S7 | 表格用 `innerHTML` 插入 Sheet 內容 | row 渲染 |
| S8 | 手機上是 7 欄橫向捲動表格，不好閱讀 | `styles.css` |
| S9 | 摘要只有「可用資金」「股票現值」，沒有總成本、總損益、總資產 | — |
| S10 | 首頁沒有入口（這可能是刻意的，見 §5 決策） | — |

---

## 2. 翻新原則

1. **維持零 build step**：繼續是可以直接被 GitHub Pages 服務的靜態檔案。改用原生 ES modules（`<script type="module">`）拆分共用程式碼，不引入 bundler / framework。這讓任何一次修改都能直接開檔案驗證，也不會多一層部署風險。
2. **不加 runtime 相依**：移除 Font Awesome 等 CDN；icon 改用 inline SVG。
3. **開發工具可以有，但不是必要**：Node 只用於跑測試（`node --test`，不需要 `package.json` 相依）與 Prettier 格式化。
4. **一次只動一個區塊**：股票頁、首頁、共用樣式、各遊戲分開 commit / PR，出問題能單獨 revert。
5. **行為不變的重構與功能變更分開**：先重構（有測試保護）再改功能。

---

## 3. 股票頁（最優先，嚴格保護現有功能）

### 3.1 必須保持不變的行為（Invariants）

以下是目前實際依賴的行為，任何修改都**不能改變**，除非另外明確決定：

| 項目 | 目前行為 |
|------|----------|
| 資料來源 | Sheet ID `1fB2bHIsqryppo-_r5mXzBUxBOSgtYjcQ_WclKYELHnE`，透過 `gviz/tq?tqx=out:csv&sheet=<name>` 讀取 |
| 持股分頁 | `持股狀況`，以第一列為欄位名稱 |
| 使用欄位 | `股票`、`持有股數`、`買入均價`、`現價`、`市值`、`未實現損益`、`未實現損益率` |
| 可用資金 | 從 `使用前請注意` 分頁的**第一列**找到 `剩餘資金` 這格，取它右邊那格的值 |
| 有效列篩選 | `持有股數` 非空字串的列才顯示 |
| 股票現值 | 加總所有有效列的 `市值`，但**排除 `股票 === '總和'` 的列** |
| 成本欄 | 前端計算：`持有股數 × 買入均價`（不讀 Sheet） |
| 未實現損益 / 損益率 | 直接使用 Sheet 的值；損益率原字串照印 |
| 正負顏色 | **台股慣例：漲紅跌綠**。`未實現損益` 解析後 `>= 0` 套 `.positive`（紅 `#d32f2f`），否則 `.negative`（綠 `#388e3c`）。注意：無法解析（`--`）時目前會套 `.negative` 綠色，這是現有 quirk，修正前要先確認 |
| 數字格式 | `zh-TW` / `TWD`；金額 0 位小數、價格 2 位小數；股數 `toFixed(0)` |
| 錯誤處理 | 持股分頁讀取失敗 → 顯示錯誤訊息；可用資金讀取失敗 → 只顯示 `--`，不視為錯誤 |

### 3.2 安全網：先建測試再動程式

1. 把目前 `script.js` 中的**純函式**（CSV 解析、摘要計算、數字格式化、列轉成顯示資料）抽到 `stock/lib.js`（ES module），DOM 操作留在 `stock/script.js`。這一步只搬移、不改邏輯。
2. 從真實 Sheet 直接抓一份 CSV 快照存成 fixture（`stock/__tests__/fixtures/holdings.csv`、`notes.csv`），**使用真實資料、不做去識別化**（repo 本來就是公開的，投資組合公開無妨）。
3. 用 `node --test` 寫 golden test：fixture → 解析 → 顯示用資料，斷言結果與重構前完全一致。期望值以 Google Sheet 上的數字為準（直接對表）。
4. 之後每一個股票頁的修改都必須通過這組測試，且在本機開頁面、與 Google Sheet 上的數字逐欄對照一次。

### 3.3 效能優化

- **並行請求**：兩個 Sheet 用 `Promise.allSettled` 同時發出（保留「可用資金失敗不算錯誤」的語意，所以用 `allSettled` 而不是 `all`）。
- **合併 CSV parser**：只保留一份，改成逐字元處理整份文字的 parser，正確處理 `\r\n` 與引號內換行。
- **不使用快取（已決定）**：1b 曾加入 localStorage 快取讓開頁先顯示上次資料，1c 時移除，因為資訊準確優先於快 4 秒。現在的規則：
  - 開頁一律顯示 spinner，直到從 Sheet 抓到最新資料才顯示數字。
  - Sheet 請求使用 `cache: 'no-store'`，不讓瀏覽器 HTTP 快取介入。
  - 刷新中與刷新失敗時，畫面上保留的只會是**本次開頁後**抓到的資料，並標示該資料的時間（「更新中…」/「更新失敗」）。
  - `styles.css`、`script.js`、`lib.js` 的網址帶版本參數（`?v=1c`），部署後不會拿到新舊混用的檔案；**之後修改這三個檔案時要一起更新版本參數**。
  - 已知無法處理的延遲：Sheet 裡的現價若來自 GOOGLEFINANCE，本身可能延遲最多約 20 分鐘。
- **請求控制**：刷新時用 `AbortController` 取消前一次請求；按鈕在載入中 disabled 並顯示狀態。
- **（選配）自動刷新**：台股交易時段（週一至五 09:00–13:30）每 N 分鐘刷新，`document.hidden` 時暫停。預設關閉，用開關控制。

### 3.4 UI / 視覺優化

- **不再整頁藏起來**：刷新時保留現有內容，只在數字區塊上顯示 skeleton / 淡化，避免閃爍。
- **錯誤狀態**：失敗時保留上次成功的資料，上方顯示「無法更新，顯示的是 xx:xx 的資料」+ 重試按鈕。
- **摘要卡擴充**（新增，不取代既有兩項）：持股成本、總未實現損益（金額與 %）、總資產（可用資金 + 股票現值）。計算方式寫在 `lib.js` 並有測試。
  - 持股成本 = Σ(持有股數 × 買入均價)，與表格「成本」欄一致。
  - 總未實現損益率 = Σ未實現損益 ÷ 持股成本（已決定）。注意 Sheet 每一檔的損益率是 `未實現損益 ÷ 支出`，支出包含已賣出部位的歷史支出，所以兩者算法不同。
- **手機版**：≤ 600px 時表格改為每檔股票一張卡片（代號 + 損益放大，其餘兩欄排列）。
- **數字排版**：`font-variant-numeric: tabular-nums`，數字欄靠右對齊。
- **排序**：點欄位標題可排序（預設維持 Sheet 原本順序）。
- **安全**：表格改用 `textContent` 建立 cell，不再用 `innerHTML` 插入 Sheet 內容。

---

## 4. 首頁

### 4.1 效能

- **H1 靜態縮圖取代 iframe**：
  - 每款遊戲產生一張縮圖 `games/<name>/thumb.webp`（約 600×400、品質 75，目標每張 < 30KB）。
  - `games.json` 新增 `thumbnail` 欄位。
  - 卡片使用 `<img loading="lazy" decoding="async" width height>`，固定比例避免 layout shift。
  - 縮圖可用 headless Chrome 截圖腳本產生（放在 `scripts/`，屬開發工具，不部署也不影響網站）。
  - 可選：hover 時才載入 iframe 做動態預覽（桌機限定），但預設不做。
- **H2** 移除 Font Awesome，改 inline SVG（GitHub、搜尋兩個 icon）。
- **H3** 移除訪客 IP / 國旗顯示（見 §5 決策）。
- **H4** 以 GitHub Actions 部署時產生 `deployment-info.json`，或直接移除此區塊（見 §5）。
- 資源提示：`games.json` 可以 inline 進 HTML 或加 `<link rel="preload" as="fetch">`，減少一次瀑布請求。

### 4.2 UI

- 篩選邏輯合併為單一 `applyFilters({ category, query })`，並把狀態同步到 URL（`?category=board&q=chess`），重新整理後保留。
- 搜尋無結果時顯示 empty state 與「清除篩選」按鈕。
- 卡片改用 `<a href="games/<name>/">` 或 `<button>`：可鍵盤操作，且中鍵/長按可以在新分頁直接開遊戲。
- Modal 改用原生 `<dialog>`：內建 Esc 關閉、focus 管理；關閉後焦點回到原卡片；以 `#play=<id>` 支援直接分享連結。
- 事件改用 event delegation（在 `.game-grid` 上綁一次）。

### 4.3 視覺

- 保留目前深色 + 綠色 accent 的識別，但建立一套 design tokens（見 §6），加入：
  - 字體層級（標題 / 內文 / 說明三級）與 4px 基準的間距系統。
  - 卡片 elevation 與 hover 狀態（陰影 + 縮圖輕微放大），並尊重 `prefers-reduced-motion`。
  - 分類標籤（chip）顯示在卡片上。
  - 更清楚的 focus ring。

---

## 5. 需要決定的事項

| 決策 | 建議 | 備註 |
|------|------|------|
| 訪客 IP / 國旗是否保留 | ✅ 已決定：**移除**（Phase 2） | 兩個第三方請求、常被 rate limit，對使用者沒有實際用途 |
| 「Last updated」來源 | ✅ 已決定：**移除**（Phase 2） | 部署走 GitHub 內建的 Pages 流程，不為了一個日期改部署方式 |
| 股票頁是否在首頁放入口 | **不放**（維持目前隱藏入口） | 私人使用的頁面 |
| 股票頁測試 fixture 用真實或假資料 | ✅ 已決定：**真實資料**，直接對 Google Sheet 驗證 | 投資組合公開無妨 |
| 是否導入 build 工具 | **不導入** | 見 §2 |

---

## 6. 共用設計系統（shared/）

`shared/` 目錄（Phase 3 建立）：

```
shared/
├── tokens.css        # 顏色、陰影、字體（CSS custom properties）；首頁與股票頁已引用
├── game-shell.css    # 遊戲共用版型：header / info bar / board / controls / game-over modal
├── game-utils.js     # ES module：canvas DPR 縮放、固定步長 loop、自動暫停、最高分、輸入
└── __tests__/        # game-utils.js 的 node --test
```

**tokens.css** 分兩層：原始色票（`--gray-*`、`--green-*`、`--red-*`）與用途（`--color-*`、`--shadow-*`、`--font-*`）。頁面只使用用途層。

- 原始色票忠實保留翻新前兩頁實際用到的每一個值（包含很接近的灰色），所以改用 tokens 後畫面完全不變（以 `scripts/style-snapshot.js` 比對確認）。
- 主要用途 tokens：`--color-bg` / `--color-surface*` / `--color-control*`（背景層級）、`--color-text*`、`--color-border*` / `--color-divider`、`--color-accent`、`--color-gain`（漲紅）/ `--color-loss`（跌綠）、`--color-danger-*`、`--shadow-md` / `--shadow-lg`、`--font-sans` / `--font-legacy`。
- **尚未抽成 tokens**：間距與圓角。兩頁目前用的值不一致（5 / 6 / 8 / 10px），統一會改變畫面，留到 Phase 4 視覺調整時一起做，並同時合併相近的灰色。
- 原規劃的 `base.css`（reset、focus ring、reduced-motion）同樣移到 Phase 4，因為套用它會改變畫面。

遷移方式：每款遊戲先把寫死的色碼換成 token（純視覺等價替換，用 `style-snapshot.js` 確認），再逐步套用 `game-shell.css`。

---

## 7. 遊戲共通改善（game-utils.js）

| 功能 | API 草案 | 說明 |
|------|----------|------|
| 高解析 canvas | `setupCanvas(canvas, cssWidth, cssHeight, { setStyle })` → `ctx` | 依 `devicePixelRatio` 設定實際像素並 `setTransform`，遊戲邏輯仍用 CSS 座標；版面由 CSS 控制尺寸時傳 `setStyle: false` |
| 遊戲 loop | `createLoop({ update(dt), render(alpha), step })` → `{ start, stop, running }` | rAF + fixed timestep，避免高更新率螢幕（120Hz）跑兩倍速；長時間中斷後最多補算 0.25 秒 |
| 自動暫停 | `autoPause({ pause, resume })` → `dispose` | `visibilitychange`（分頁切走、首頁 modal 關閉）時暫停 |
| 最高分 | `highScore(gameId, { order })` → `{ get, submit }` | localStorage，key 為 `jsgames:<gameId>:best`，`order: 'asc'` 用於「越少越好」（例如秒數）；不可用時不丟錯 |
| 輸入 | `onSwipe(el, cb)`、`bindKeys(map)` → `dispose` | Pointer Events 滑動（滑鼠 + 觸控）；鍵盤以 `event.key` 對應，會 preventDefault 避免捲動頁面 |

套用順序：先 canvas 遊戲（DPR + 暫停效益最大），再 DOM 遊戲（ARIA、鍵盤、最高分）。

每款遊戲的完成定義見 ROADMAP 的「遊戲驗收清單」。

---

## 8. 驗證方式

| 範圍 | 方式 |
|------|------|
| 股票頁邏輯 | `npm test`（golden fixture，對照重構前版本） |
| 股票頁畫面 | 本機 `python3 -m http.server` 開啟，對真實 Sheet 比對數字與重構前一致；手機寬度 375px 檢查 |
| 首頁效能 | Lighthouse（Mobile）翻新前後各跑一次記錄在 PR；指標：LCP、TBT、總傳輸量、請求數 |
| 遊戲 | 每款手動遊玩：開始 → 得分 → Game Over → 重玩；桌機鍵盤 + 手機觸控；切分頁回來應為暫停 |
| 只改 CSS 結構、不改外觀 | `scripts/style-snapshot.js`：用 `git worktree` 取出改動前版本，以 `--root` 記錄前後兩份 computed style 再 `--diff`；桌機 1280px 與手機 375px 各比一次 |
| 共用工具 | `npm test`（`shared/__tests__/`） |
| 格式 | `npx prettier --check .`（沿用現有 `.prettierrc`） |

---

## 9. 文件同步

完成後需更新：

- `README.md`：專案結構加入 `shared/`、`docs/`，新增遊戲流程加入縮圖步驟。
- ~~`AI_GUIDE.md`~~ → 已改寫為 `CLAUDE.md`：引用 `shared/` 的 tokens、`game-shell.css`、`game-utils.js`，記錄翻新後的遊戲結構（core.js + 測試），移除寫死色碼的舊模板。
