# 翻新路線圖（ROADMAP）

技術細節與問題編號（H1、S1…）請對照 [IMPLEMENTATION.md](./IMPLEMENTATION.md)。

排序原則：**先保護正在使用的功能（股票頁）→ 再處理效益最大的效能問題（首頁）→ 建立共用基礎 → 逐款翻新遊戲**。每個 Phase 都可以獨立上線。

## 目前進度（2026-10-02）

| Phase | 狀態 |
|-------|------|
| 0 準備與基準線 | ✅ 完成 |
| 1 股票頁 | ✅ 完成（只剩選配的交易時段自動刷新，暫不做） |
| 2 首頁效能 | ✅ 完成，Lighthouse Mobile 79 → 100 |
| 3 共用設計系統 | ✅ 完成 |
| 4 首頁 UI / 視覺 | ⏸ 尚未開始：先做 Phase 5 的遊戲翻新，之後再回來 |
| 5 遊戲逐款翻新 | 🔄 進行中：21 款完成 11 款（5a 動作類全部完成，5b 完成 2048、minesweeper、sudoku、wordle）（見 Phase 5 狀態表） |
| 6 收尾 | 🔄 `CLAUDE.md`（含回合制 DOM 遊戲的做法）、`README.md` 已更新，其餘未開始 |

下一步：5b 益智類剩下的 memory_match、bulls_and_cows。

---

## Phase 0 — 準備與基準線

- [x] 刪除本機空資料夾 `games/super_mario/`
- [x] 對首頁跑 Lighthouse（Mobile），記錄 LCP / TBT / 傳輸量 / 請求數作為基準
- [x] ~~對股票頁截圖作為視覺比對基準~~ → 改用 golden test 對照重構前的版本（Phase 1a）
- [x] 確認 IMPLEMENTATION §5 的決策項目

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
- [x] ~~localStorage 快取上次結果，開頁先顯示快取再背景更新~~ → 1c 時移除：資訊準確優先，開頁一律等最新資料（見 IMPLEMENTATION §3.3）
- [x] 表格改用 `textContent` 建立（S7）

> golden 仍由 `64a88b7` 產生：測試工具把新舊版的表格都轉成「每格文字 + class」再比對，所以改用 `textContent` 後，比對基準仍是重構前的原始版本。

**完成條件**：首次載入時間約為原本的一半（兩個請求並行）；連點刷新不會出現錯亂資料；畫面上的數字一律是本次開頁後從 Sheet 抓到的。

### 1c. UI / 視覺

- [x] 刷新時保留內容並淡化、標示「更新中…」，不再整頁閃爍（S4）
- [x] 刷新失敗時保留本次開頁抓到的資料並標示資料時間 + 重試按鈕（S5）
- [x] 摘要卡新增：總資產、持股成本、總未實現損益（金額 / %，% 以持股成本為分母）（S9）
- [x] 手機版（≤ 600px）改卡片列表，另有排序選單（S8）
- [x] 數字 `tabular-nums`、靠右對齊；點表頭排序（高→低 → 低→高 → 原始順序）
- [x] Sheet 請求加 `cache: 'no-store'`；`styles.css` / `script.js` / `lib.js` 加版本參數，避免部署後新舊檔案混用
- [ ] （選配）交易時段自動刷新，預設關閉 — 暫不做

**完成條件**：既有欄位數字不變；新摘要數字有單元測試；375px 寬無橫向捲動。

---

## Phase 2 — 首頁效能

- [x] 縮圖產生腳本 `scripts/capture-thumbs.js`（本機 Chrome + DevTools Protocol，無相依套件），產出 21 張 `thumb.webp`（每張 2–5 KB）
- [x] `games.json` 加入 `thumbnail`；卡片改 `<img>`（前 4 張立即載入、其餘 `loading="lazy"`），移除預覽 iframe（H1）
- [x] 移除 Font Awesome，改 inline SVG（H2）
- [x] 移除訪客 IP / 國旗（H3）
- [x] 移除「Last updated」與 `deployment-info.json` 請求（H4）
- [x] `games.json` 在腳本一載入就開始抓，不等 DOMContentLoaded

> 縮圖更新：`node scripts/capture-thumbs.js [game-id ...]`（不帶參數則全部重截）。

**完成條件**：首頁不再有任何 iframe 在背景執行；Lighthouse Mobile 效能分數與傳輸量相比 Phase 0 基準有明顯改善（目標：請求數 < 30、無第三方請求、TBT < 200ms）。

---

## Phase 3 — 共用設計系統

- [x] 建立 `shared/tokens.css`（顏色、陰影、字體）
- [x] 首頁與股票頁改用 tokens：兩頁在 1280px / 375px 下 computed style 與改動前完全相同（`scripts/style-snapshot.js`）；股票頁 `npm test` 通過
- [x] 建立 `shared/game-shell.css`、`shared/game-utils.js`（DPR、loop、自動暫停、最高分、輸入）— 尚未套用到遊戲，Phase 5 使用
- [x] 為 `game-utils.js` 寫 `node --test`（10 項）
- [x] 抽出 `scripts/lib/cdp.js`（本機 Chrome 控制），`capture-thumbs.js` 與 `style-snapshot.js` 共用
- [ ] ~~`shared/base.css`、間距 / 圓角 tokens~~ → 移到 Phase 4（套用會改變畫面）

**完成條件**：三個主要頁面引用同一份 tokens；換色只需要改 `tokens.css`。

---

## Phase 4 — 首頁 UI / 視覺

- [ ] 建立 `shared/base.css`（reset、focus ring、reduced-motion），加入間距 / 圓角 tokens，合併相近的灰色
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

### 狀態

「重新設計」代表不只套驗收清單，而是重寫規則與畫面：規則抽到 `core.js` 並有 `node --test`，畫面改用 `shared/game-shell.css` 的 `body.stage` 元件（做法記錄在 `CLAUDE.md`）。

| 批次 | 遊戲 | 狀態 |
|------|------|------|
| 5a | tetris | ✅ 已上線，使用者實測沒問題 |
| 5a | snake | ✅ 已上線，使用者實測沒問題 |
| 5a | space_invaders | ✅ 已上線 |
| 5a | raiden_fighters | ✅ 已上線；難度數值（頭目血量、敵彈速度）待實玩回饋 |
| 5a | dino_runner | ✅ 已上線 |
| 5a | tank_battle | ✅ 已上線；難度數值待實玩回饋 |
| 5a | breakout | ✅ 已上線；球速、膠囊機率、觸控拖曳倍率待實玩回饋 |
| 5b | 2048 | ✅ 已上線 |
| 5b | minesweeper | ✅ 已 commit，尚未 push |
| 5b | sudoku | ✅ 已 commit，尚未 push |
| 5b | wordle | ✅ 已 commit，尚未 push |
| 5b | memory_match、bulls_and_cows | ⬜ 下一批 |
| 5c | chess、chinese_chess、checkers、reversi、gomoku、connect_four、tic_tac_toe | ⬜ |
| 5d | solitaire | ⬜ |

目前 `npm test` 共 189 項（股票頁、shared、11 款遊戲的 core.js）全部通過。已完成的 11 款都還沒在實體手機上測過觸控手感與 120Hz 螢幕，驗證方式是 headless Chrome 截圖（桌機 / 縮圖 / 手機觸控模擬）加模擬操作。

### 各款內容

- [x] tetris — 重新設計：SRS 旋轉 / 踢牆、7-bag、Hold、Ghost、5 格預覽、鎖定延遲、T-spin / Back-to-back / Combo 計分；規則抽到 `core.js` 並有 `node --test`；方塊改為預先繪製的立體 sprite、消行動畫與粒子、硬降光軌；手機手勢 + SVG 觸控按鈕；最高分；切分頁 / 失焦自動暫停
- [x] snake — 重新設計：轉向佇列（快速連按不漏、不能迴轉）、速度隨長度上升、限時金色星星（越早吃分數越高）、填滿場地獲勝；規則在 `core.js` 並有測試；蛇身改為平滑插值移動的連續身體、眼睛看向果實、吞下的果實在身體裡鼓起；果實用 SVG path 繪製；滑動不需放開手指即可連續轉向 + 十字方向鍵
- [x] space_invaders — 重新設計：5×11 三種外星人（10 / 20 / 30 分）步進行軍並隨數量加速、最下排投彈（兩種炸彈）、子彈互撞、4 座像素級可破壞護盾、神秘 UFO、重生、1500 分加一命、每波更低更快；規則在 `core.js` 並有測試；兩影格像素圖 + 光暈、星空、爆炸粒子、被擊中震動；邏輯像素對齊裝置像素保持銳利；手機整個畫面（含場地下方）都能拖曳移動、按住自動射擊
- [x] raiden_fighters — 重新設計：雷電式紅藍 P 道具（Vulcan 散射 / Laser 集中，4 級）、M 追蹤飛彈、B 炸彈（清除全畫面子彈）；三種敵機隊形出場、每關第 55 秒頭目（兩階段彈幕）、過關難度上升；小判定點、被擊中降一級並無敵重生；規則在 `core.js` 並有測試；機體以 SVG path 繪製、捲動地圖與雲、白芯敵彈、爆炸與震動、頭目血條；自動射擊，鍵盤 Shift 慢速、X 炸彈，手機整個畫面拖曳 + 炸彈按鈕
- [x] dino_runner — 重新設計：按住跳更高 / 點一下小跳、空中按下加速下墜、蹲下；三種高度的翼龍（350 分起）、仙人掌單株與群組、間距隨速度調整、多個碰撞框；規則在 `core.js` 並有測試；沙漠日夜循環（白天 → 黃昏 → 星空與月亮 → 黎明）、兩層平頂山視差、恐龍 / 仙人掌 / 翼龍以 SVG path 繪製、落地揚塵、每 100 分閃爍；直向手機把天空往上延伸讓場地變高；手機點場地跳 + 跳 / 蹲按鈕；沿用舊版 `dinoHighScore` 最高分
- [x] tank_battle — 重新設計為坦克大戰（Battle City）規則：13 × 13 地圖（磚以 4 單位小塊逐步打穿、鋼板、水、樹叢），4 張地圖輪替；守護基地老鷹，被打中即結束；每關 20 輛、場上最多 4 輛，四種敵人（一般 / 快速 / 火力 / 4 發才打得掉的重裝甲），越後面的關卡越多重裝甲、越快越常開火；第 4、11、18 輛閃紅光，打中掉道具（頭盔、星星 3 級、手榴彈、時鐘、鏟子、坦克）；轉彎對齊半格方便鑽通道；子彈互撞抵銷；規則在 `core.js` 並有測試；移除舊版 `setInterval` loop；坦克、老鷹、道具以向量繪製，磚紋 / 鋼板 / 水波 / 樹叢分層（地形變動時才重畫），爆炸碎片、分數、出生閃光、護盾；手機為拖曳搖桿 + 按住連發的開火鈕
- [x] breakout — 重新設計為 Arkanoid 式規則：5 個關卡輪替（銀磚要打多下且隨關卡變硬、金磚打不破）、反彈角度依擊中擋板的位置決定、每打一塊加速且撞牆時保證最小垂直速度；膠囊道具 E 加長、S 減速、C 接球、L 雷射、D 分裂三顆、P 加命（同時只掉一顆、多球時不掉）；開局球黏在擋板上由玩家發射；規則在 `core.js` 並有測試；漸層磚塊與金屬反光、銀磚裂痕、球的光暈與拖尾、碎片、擋板加長動畫；滑鼠跟隨 / 鍵盤 / 手機整個畫面相對拖曳，放開發射、按住開火
- [x] 2048 — 重新設計：規則抽到 `core.js` 並有測試，修正舊版一步內重複合併的 bug（`4 4 8` 往左原本會變 16）；做出 2048 可選擇繼續、沒有步可走時結束；可復原上一步（結束畫面也能復原）；進行中的局面存在 localStorage（`jsgames:2048:game`），關掉 modal 再開可以接著玩；方塊改用 DOM + CSS transform 滑動、合併彈跳、新方塊淡入，盤面以 container query 自動縮放；方向鍵 / WASD、手機滑動；ARIA live region 朗讀每一步的結果；沿用舊版 `bestScore` 最高分。回合制所以沒有暫停與自動暫停
- [x] minesweeper — 重新設計：三種標準難度（初級 9×9/10、中級 16×16/40、專家 16×30/99，直向手機上專家盤面轉成 30×16），記住上次選的難度；第一下保證安全且一定打開一片；點數字連鎖翻開（chord），旗子插錯會踩雷；贏了自動插上剩下的旗；規則在 `core.js` 並有測試；格子是 `<button>`，方向鍵移動、Space / Enter 翻開、F 插旗，每格有 aria-label；滑鼠右鍵插旗、手機長按插旗並有「挖 / 插旗」切換；展開由點擊處往外的動畫、輸了地雷依距離連鎖爆開、插錯的旗打叉；各難度分開記錄最佳時間（`highScore('minesweeper:<難度>', { order: 'asc' })`）；暫停 / 切分頁 / 失焦時停止計時並蓋住盤面；移除 `alert()`
- [x] sudoku — 重新設計：四種難度（Easy / Medium / Hard / Expert），出題保證唯一解、提示數字對中心點對稱，並以解題技巧評等（Easy / Medium 只需唯一候選數與唯一位置，Hard 需要區塊排除或數對，Expert 需要更進階的技巧），每題產生不到 15 ms；筆記（填數字時自動移除同列 / 行 / 宮的筆記）、復原、提示（優先修正填錯的格子，否則選最容易推出的空格）；即時標示重複數字、選取格的同列 / 行 / 宮與相同數字（含筆記）；完成一列 / 行 / 宮的光波、整盤完成的擴散動畫；數字鍵顯示每個數字還剩幾個；移除舊版的 `alert()` 與「Solve」按鈕；規則在 `core.js` 並有測試；格子是 `<button>`，方向鍵移動、數字填入、Shift + 數字或 N 寫筆記、Backspace 清除、U / H 復原與提示；直向手機數字鍵排成一列、橫向螢幕放在盤面右邊排成 3 × 3；進行中的局面與時間存在 `jsgames:sudoku:game`，再開時停在暫停畫面接著玩；各難度分開記錄最佳時間（用了提示不記錄）；暫停 / 切分頁 / 失焦時停止計時並蓋住盤面
- [x] wordle — 重新設計：每日題目（依當地日期，所有人同一天同一個字，答案清單以固定種子洗牌）與無限練習兩種模式，各自存檔與統計；可猜的字從 2,316 個擴充到約 14,800 個（複數、動詞變化也能猜），答案仍只從常見字出題；困難模式（猜中的位置要沿用、出現過的字母要用上，不符合時說明原因，只能在第一次猜之前切換）；重複字母依答案裡的數量上色；統計（遊玩次數、勝率、連勝、最長連勝、猜幾次的分布，每日題目漏掉一天連勝就斷），最長連勝用 `highScore('wordle:<模式>')`；結果可分享為 emoji 方格（複製到剪貼簿）；每日題目完成後倒數下一題；練習中途換字算輸並先確認；規則在 `core.js` 並有測試；翻牌、輸入彈跳、不合法時整列搖晃、猜中時跳動、上方提示訊息；螢幕鍵盤依結果上色；每列有 aria-label、aria-live 朗讀每次猜測的結果；橫拿手機時鍵盤放在盤面右邊；移除舊版的 inline `onclick`
- [x] 共用：開始 / 暫停 / 結束畫面、`kbd`、觸控按鈕、圖示按鈕從 tetris 抽到 `shared/game-shell.css`（`<body class="stage">`），新增 `--color-highlight`、`--color-stage-overlay` tokens

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

- [x] `AI_GUIDE.md` 改寫為 `CLAUDE.md`（引用 `shared/`、記錄翻新後的遊戲結構與工作方式）
- [x] `README.md` 精簡為簡介、本機執行與目錄概覽，細節改由 `CLAUDE.md` 與 `docs/` 說明
- [ ] 最後一次 Lighthouse，與 Phase 0 基準對照
- [ ] （選配）GitHub Actions：`prettier --check` + `node --test`

---

## 基準紀錄

線上首頁（`https://flyingdog1310.github.io/`，Lighthouse 12，Mobile 模擬）：

| 指標 | Phase 0（2026-09-29） | Phase 2 後（2026-09-29，跑 2 次） | Phase 6 後 |
|------|---------|------------|------------|
| Lighthouse Performance (Mobile) | 79 | 100 | |
| FCP / LCP | 3.3 s / 3.3 s | 0.8–1.1 s / 1.0–1.1 s | |
| TBT | 290 ms | 0 ms | |
| 請求數 | 77 | 21 | |
| 傳輸量 | 345 KB | 59 KB | |
| 第三方網域 | 5（cdnjs、ipify、ipapi、flagcdn…） | 0 | |

本機同條件比較（`python3 -m http.server`，Lighthouse Mobile，Phase 2 改動前後）：

| 指標 | 改動前 | 改動後 |
|------|--------|--------|
| 主執行緒工作 | 1.6 s | 0.1 s |
| 請求數 | 77 | 21 |
| 傳輸量 | 552 KB | 75 KB |
| FCP / LCP | 1.6 s / 1.6 s | 0.9 s / 1.3 s |

> Lighthouse 只量到載入完成為止；舊版 21 個 iframe 遊戲在載入後仍持續執行，實際 CPU / 電量差距比表上更大。
