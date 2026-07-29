# 偶運會時間對應表 — 背景推播提醒版

這個資料夾是完整的 Node.js 服務，跟原本雙擊打開的靜態版不同，這個必須部署到伺服器（Render）才能運作，
因為背景推播通知需要一台隨時在線的伺服器負責在正確時間送出通知。

## 流量會不會爆掉？可以負荷多少人使用？

**先說重點：Render 免費（Hobby）方案在 2026 年 4 月 23 日調整過，流量從原本的 100GB／月，
砍到只剩 5GB／月**（如果你的帳號是那之前建立的，可能還在用「Legacy Hobby」100GB，但會在
2026/8/1 被強制轉移到新方案，建議直接抓 5GB 來估算比較保險）。RAM 512MB／0.1 CPU 這台小網站
用起來綽綽有餘，不是瓶頸，流量才是真正要注意的地方。

以這個網站實際大小估算：

- 完全沒快取的一次完整載入（html+css+js+地圖圖片）大約 **183KB**
- 已經在 `server.js` 加上 **gzip 壓縮**（文字類資源可壓縮到剩約 20-30%）和 **瀏覽器快取**
  （css/js/圖片快取 7 天，同一個人重複訪問幾乎不會再消耗流量，只有 index.html 本身不快取，
  確保你更新內容後大家能馬上看到最新版）
- 用 5GB／月的額度換算：
  - 沒優化前：約可負荷 **28,600 次**完整載入／月
  - 加上壓縮＋快取後：約可負荷 **38,400 次**完整載入／月，而且「回訪」幾乎不佔額度

對一個活動時間表這種給幾十到幾百人在活動前後查看的用途來說，**5GB 完全夠用**，不用擔心。
真正比較需要注意的反而是前面提到的「閒置15分鐘會睡著」，會影響提醒是否準時發送，跟流量是
兩件不同的事。

（以上流量方案資訊是我另外查證確認的，Render 的收費規則之後可能還會再調整，正式使用前建議
到 Render 後台的 Billing 頁面看一下當下實際生效的方案數字。）

## 部署到 Render 的步驟

1. 把這整個資料夾上傳到一個 GitHub repo（Render 需要從 repo 部署，或用 Render 的手動上傳功能）。
2. 到 [render.com](https://render.com) 建立新的 **Web Service**，選擇這個 repo。
3. 設定：
   - **Build Command**：`npm install`
   - **Start Command**：`npm start`
   - **Instance Type**：至少要選 **不會 sleep 的付費方案**（見下方「重要限制」）。
4. 在 Render 的 **Environment** 設定裡加入以下三個環境變數：

   | Key | Value |
   |---|---|
   | `VAPID_PUBLIC_KEY` | `BBRnz6tHZu_R7p-DEOoLwTmH8Jml4G4WbDU3qBREQbR0LVOSyScZqo35qqOxxFLCOv8z--TMjs33qdTr35hhbqY` |
   | `VAPID_PRIVATE_KEY` | `_wT6KQDaoTY6RnBddApuSA1UfVKQTDmKKxvks6EMS3M` |
   | `VAPID_SUBJECT` | `mailto:你的信箱@example.com`（隨便填一個你的信箱，供推播服務識別身份用，不會公開顯示） |

   > 這組金鑰是我這次順便幫你產生的，可以直接使用；如果想換一組，本機執行
   > `npx web-push generate-vapid-keys` 就能自己重新產生一組。

5. 部署完成後，Render 會給你一個網址（例如 `https://xxx.onrender.com`），之後就用這個網址開啟，
   不要再用本機檔案打開了（推播功能需要 https）。

## 重要限制，部署前務必知道

- **Render 免費方案會「睡著」**：閒置 15 分鐘沒人連線就會自動關機，之後才有請求進來才會重新啟動
  （喚醒要 30 秒以上）。伺服器負責「定時檢查、準時發送提醒」這件事，**睡著期間排程完全不會執行**，
  提醒時間到了也不會發送，等到下次有人隨便訪問網站才會補發。如果你要提醒真的準時，**這裡必須升級成
  付費、不會 sleep 的方案**，或是自己另外設定一個免費的外部喚醒服務（例如 [cron-job.org](https://cron-job.org)
  每 5 分鐘打一次 `https://你的網址/api/tick` 保持喚醒＋順便觸發檢查），否則免費方案只適合測試，
  不適合正式依賴。
- **硬碟不是永久的**：目前提醒資料存在伺服器上的一個 `data.json` 檔案裡，每次重新部署（改程式碼、
  或 Render 自動重啟）都可能會被清空。這對「短期活動用的提醒工具」影響不大，但不要拿來存長期重要資料。
- **iPhone 必須先加入主畫面**：iOS 的 Safari 只有在網頁被加到主畫面、變成一個獨立 App 圖示之後，
  才能收到背景推播；單純用 Safari 分頁開著是收不到的。步驟：用 Safari 開啟網址 → 下方分享按鈕 →
  「加入主畫面」→ 之後都改用主畫面上的圖示開啟。
- Android 的 Chrome 不需要安裝，直接開網頁、允許通知權限即可。

## 本機測試

已經幫你準備好 `.vscode/launch.json`，裡面直接帶了金鑰，在 VS Code 打開這個資料夾後按 **F5**
（或側邊「Run and Debug」→ 選 "Run Server (local)" → 播放鍵）就能啟動，開瀏覽器連到
`http://localhost:3000` 即可。

> ⚠️ **`launch.json` 裡面直接寫了 VAPID 私鑰**，方便你本機一鍵執行。我已經把它加進
> `.gitignore`，如果之後要把這個專案推到「公開」的 GitHub repo，請確認 `.vscode/launch.json`
> 真的沒有被一起推上去，不然私鑰會外流。如果是私人 repo 則沒差。

也可以不用 VS Code 的除錯功能，改用終端機手動下指令啟動：

```bash
npm install
VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:you@example.com npm start
```

用 `https://localhost:3000`（或用像 ngrok 這類工具做一個 https 網址）打開測試，因為 Service Worker
在純 `http://` 下也無法註冊（`http://localhost` 例外，瀏覽器通常會放行方便開發）。

## 檔案說明

- `server.js`：後端，負責存推播訂閱、存提醒排程、每 30 秒檢查一次到期的提醒並送出推播。
- `public/`：前端網頁本體（跟你原本的版本一樣的介面），額外多了「🔔 啟用背景推播並儲存」的按鈕。
- `public/sw.js`：Service Worker，真正接收推播、跳出系統通知的地方，跟分頁開關無關。
- `data.json`：伺服器執行後自動產生，存放訂閱與提醒資料（見上方硬碟限制說明）。
