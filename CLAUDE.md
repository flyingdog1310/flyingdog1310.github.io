# CLAUDE.md

GitHub Pages 靜態網站（https://flyingdog1310.github.io/）：首頁遊戲集、21 款瀏覽器遊戲、一個實際在用的股票頁、律師一試考古題頁（`bar-exam/`）。
沒有建置步驟、沒有執行期相依套件；所有 JS 都是原生 ES module 或一般 script，直接由瀏覽器載入。

翻新計畫與進度：`docs/ROADMAP.md`（勾選清單）、`docs/IMPLEMENTATION.md`（問題編號與技術細節）。

## 指令

```bash
npm test                                    # node --test：股票頁 golden test、shared/、各遊戲 core.js
python3 -m http.server                      # 本機預覽（ES module 不能用 file:// 開）
node scripts/capture-thumbs.js <game-id>    # 重新產生遊戲縮圖 thumb.webp（id 見 games.json）
node scripts/style-snapshot.js <path> <out.json> [--width 375]   # 記錄 computed style
node scripts/style-snapshot.js --diff before.json after.json     # 比對：確認純 CSS 重構沒有改到畫面
npm run stock:fixtures && npm run stock:golden   # 從真實 Google Sheet 更新股票頁測試資料
```

腳本透過 `scripts/lib/cdp.js` 用本機 Chrome（headless + DevTools Protocol）執行；Chrome 不在 macOS 預設路徑時設定 `CHROME_PATH`。
需要看畫面時也用 `cdp.js` 截圖（桌機 1280×800、縮圖 900×600、手機 390×780 並開觸控模擬），不要只看程式碼判斷版面。

## 工作方式

- 直接 commit 到 `main`，不開 feature branch。push 前先問使用者。
- Commit message 用英文 Conventional Commits（`feat(tetris): …`），內文用條列說明改了什麼。
- 一次只動一個區塊（股票頁、首頁、shared、單一遊戲），出問題可以單獨 revert。
- 每完成一個項目，更新 `docs/ROADMAP.md` 的勾選與進度。
- 程式碼註解用繁體中文，風格跟周圍一致；遊戲 UI 文案用英文、sentence case。
- 格式依 `.prettierrc`：4 空白縮排、單引號、行寬 120。

## 股票頁（`stock/`）— 最重要，不能壞

- 使用者實際在用。任何修改都要先有 golden test 保護，且 `npm test` 通過；數字要能與 Google Sheet 逐欄對上。
- 台股慣例**漲紅跌綠**（`--color-gain` 紅、`--color-loss` 綠），不要和 accent 綠混用。
- **準確優先於速度**：不快取 Sheet 資料（不用 localStorage、fetch 用 `cache: 'no-store'`），畫面上的數字一律是本次開頁後抓到的。
- 改 `styles.css` / `script.js` / `lib.js` 時要更新 `index.html` 裡的 `?v=` 版本參數。
- 測試 fixture 直接用真實 Sheet 資料（repo 公開，使用者不介意）。

## 律師考古題（`bar-exam/`）

- 題目資料 `data/<年>.json` 由 `bar-exam/tools/build_data.py` 從考選部 PDF 產生（需 PyMuPDF，用法見檔頭）；不要手改 JSON。
- 詳解不轉載（網友著作），只連到阿摩題目頁（`yamol` 欄位）。
- 一試錄取分數（`CUTOFF`）放榜後手動填入 `build_data.py`，頁面換算成「要答對幾題」。
- 作答紀錄存 localStorage `bar-exam:<年>:<科目 id>`；改 `styles.css` / `script.js` / `lib.js` 時更新 `index.html` 的 `?v=`。

## 共用資源（`shared/`）

- `tokens.css`：顏色 / 陰影 / 字體 tokens。頁面與遊戲只用第二層的 `--color-*`，不要寫死色碼（遊戲專屬顏色見下方）。
- `game-shell.css`：翻新後遊戲的共用元件，放在 `<body class="stage">` 底下：`.overlay`（開始 / 暫停 / 結束）、`.btn`、`.icon-btn`、`kbd` / `.keys`、`.pad` / `.pad__btn`（觸控按鈕，只在 `pointer: coarse` 顯示）、`.only-fine` / `.only-coarse`。檔案前半段的 `.game-container` 等是舊版 class，新遊戲不用。
- `game-utils.js`：`setupCanvas`（DPR）、`createLoop`（固定步長，60/120Hz 同速）、`autoPause`、`highScore(gameId)`（localStorage `jsgames:<id>:best`）、`onSwipe`、`bindKeys`。有測試，改動要跟著改 `shared/__tests__/`。

## 遊戲

每款遊戲在 `games/<name>/`，並登記在 `games.json`（`id`、`src`、`thumbnail`）。首頁以 iframe modal 開啟遊戲，關閉時清空 `src`。

### 翻新後的結構（新寫或翻新遊戲都照這個做；即時 canvas 遊戲參考 `games/tetris/`、`games/snake/`，回合制 DOM 遊戲參考 `games/2048/`、`games/minesweeper/`）

```
games/<name>/
├── index.html      # 引入 tokens.css → game-shell.css → style.css；<script type="module" src="script.js">
├── style.css       # 只寫這款遊戲特有的版面與顏色變數
├── core.js         # 遊戲規則：純邏輯、不碰 DOM
├── script.js       # 繪圖、輸入、狀態切換
├── __tests__/core.test.js
└── thumb.webp      # capture-thumbs.js 產生
```

**core.js**

- 匯出 `createXxx({ random = Math.random })` 回傳遊戲物件；亂數一律從參數注入，測試用固定種子。
- 即時遊戲：`update(dt, input)` 以秒為單位推進時間；input 是「目前按住的狀態」，不是事件。
- 回合制遊戲：每個動作是一個方法（如 `move(dir)`、`reveal(i)`），直接回傳這一步的結果（給畫面做動畫），沒有變化時回傳 `null`。
- 畫面需要知道的事（得分、爆炸、過關、死亡…）用事件佇列傳出：`emit({ type, … })`，`script.js` 每步呼叫 `takeEvents()`。
- 測試涵蓋主要規則與邊界情況（計分、碰撞、升級、Game over）。先寫 core 與測試再寫畫面。
- 測試需要特定盤面時，讓 `createXxx` 接受選項（地圖、關卡、存檔 `state`、關掉出怪的 `spawnEnemies: false` 等），不要在測試裡改 core 的內部變數。

**script.js**

- 狀態：`ready`（開始畫面）→ `playing` → `paused` / `over`；`setState()` 切換 `data-state` 與 overlay，只有 `playing` 時 loop 在跑。
- 開始畫面後方放一個示意盤面（demo），同時也是首頁縮圖的畫面。
- 用 `createLoop` 固定步長；canvas 用 `setupCanvas` 處理 DPR；場地尺寸由 `ResizeObserver` 依可用空間計算，遊戲邏輯使用固定的邏輯座標再縮放。
- `autoPause` + `window` 的 `blur` 都要暫停；回來後由玩家自己按繼續。
- Game over 後約 0.8 秒內不接受鍵盤重開，避免連按時直接跳過結算。
- 最高分用 `highScore('<games.json 的 id>')`；有難度之分時每個難度分開記錄：`highScore('<id>:<難度>')`；比時間的用 `{ order: 'asc' }`。舊版若另有 localStorage key，第一次載入時搬過來。
- 其他 localStorage 也用 `jsgames:<id>:` 開頭（例如 2048 的進行中局面 `jsgames:2048:game`、踩地雷記住的難度 `jsgames:minesweeper:level`），讀寫都包 `try/catch`。
- 顏色：遊戲專屬顏色寫成 `style.css` 的 CSS 變數，`script.js` 用 `getComputedStyle` 讀取；UI 部分用 tokens。
- 圖示用 inline SVG `<symbol>`；角色 / 物件優先用 SVG path（`Path2D`）繪製而不是色塊。
- 特效要尊重 `prefers-reduced-motion`（粒子、震動、閃爍）。

**回合制 DOM 遊戲的差異**（2048、踩地雷，以及之後的益智 / 棋盤類）

- 不用 canvas 與 `createLoop`：盤面是 DOM，格子用 `<button>`（可聚焦、有 `aria-label`），動畫用 CSS transition / animation。盤面大小用 container query 或 `ResizeObserver` 算格子大小。
- 鍵盤：方向鍵移動游標（roving `tabindex`），Space / Enter 交給按鈕本身的 click；另有一個 `aria-live` 區域朗讀每一步的結果。
- 觸控：滑動用 `onSwipe`；需要第二種操作（插旗等）時提供長按，並在 `pointer: coarse` 時顯示模式切換。
- 沒有計時就不需要暫停與 `autoPause`；有計時（如踩地雷）時暫停要停止計時並完全蓋住盤面。
- 會玩很久的遊戲把進行中的局面存起來，關掉 modal 再開可以接著玩；開新局前若已有進度要先確認。
- 結果畫面若需要看到盤面（踩地雷看地雷位置），文字放在不透明的卡片上，背景保持半透明。

**每款的驗收**：鍵盤與觸控都能完整遊玩、手機直向版面不溢出、Retina 清晰、有暫停 / 結束 / 再玩一次、有最高分；完整清單見 `docs/ROADMAP.md` Phase 5。完成後重新產生縮圖並在 ROADMAP 記錄。
