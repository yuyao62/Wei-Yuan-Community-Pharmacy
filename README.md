# 維元社區藥局 — 手機拍照專用收件系統（待設定版）

這套檔案是為目前的 GitHub Pages 網站 `yuyao62/Wei-Yuan-Community-Pharmacy` 準備的**獨立附加功能**，不需覆蓋既有 `index.html`。目前尚未連接實際 Supabase 專案，因此**不能收真實處方，不能宣稱正式啟用**。

## 完成後的使用流程

1. 客人手機打開 `upload.html`，開啟相機／選圖（最多 3 張）、輸入聯絡資料並完成 Turnstile 驗證。
2. 照片轉為 JPEG 後，透過 HTTPS 傳到 Supabase Edge Function；後端再次驗證 CAPTCHA，寫入**不公開**的 Storage bucket 和收件表。
3. 藥局電腦開啟 `inbox.html`，以事先授權的員工帳號登入，查看、標記已處理及刪除。
4. GitHub 只放網頁程式碼，不放處方照片、服務金鑰、管理員密碼。

## 如何啟用：需藥局管理員完成

1. 建立**獨立** Supabase 專案：<https://supabase.com>。避免重用存有其他個資的專案。
2. 在 Supabase SQL Editor 貼上 `schema.sql` 執行，確認 `pharmacy-prescriptions` 是**Private**，且 RLS 已開啟。
3. Supabase Dashboard → Authentication → Users 建立藥局員工帳號，停用公開註冊；建議啟用 MFA 並建立人員離職撤權流程。複製其 UUID，執行：
   ```sql
   insert into public.pharmacy_admins(user_id) values ('這裡換成員工-user-uuid');
   ```
4. Cloudflare Dashboard 建立 Turnstile widget：<https://dash.cloudflare.com>，允許主機名稱 `yuyao62.github.io`，取得 **site key**（公開）及 **secret key**（不可公開）。
5. 使用 Supabase CLI 登入並連結專案，在含 `supabase/` 的此資料夾中部署：
   ```sh
   supabase login
   supabase link --project-ref <你的-project-ref>
   supabase secrets set TURNSTILE_SECRET='<你的-Turnstile-secret>' ALLOWED_ORIGIN='https://yuyao62.github.io' ALLOWED_HOSTNAME='yuyao62.github.io'
   supabase functions deploy submit-prescription
   ```
   `supabase/config.toml` 已將 `submit-prescription` 設為 `verify_jwt=false`，以支援顧客免登入；**不可關閉 Edge Function 的 CAPTCHA 驗證**。不要把 Secret 貼進 GitHub 或任何 HTML。
6. 在 `config.js` 只填三個**公開**設定：Supabase Project URL、Supabase Publishable/Anon key、Turnstile **site key**。**絕對不可填 `service_role`、Supabase secret key 或 Turnstile secret**。
7. 將 `upload.html`、`upload.js`、`inbox.html`、`inbox.js`、`privacy.html`、`styles.css`、`config.js` 放入現有 GitHub Pages 網站根目錄。先開上傳網址檢查正常，再在既有首頁加按鈕。原本的 `index.html` 不用刪除或覆蓋。
8. 用**虛構資料與非真實處方的測試照片**完成至少以下測試，確認成功後再考慮正式啟用：
   - 不登入能上傳測試照片，顯示收件編號。
   - 藥局授權帳號登入可看見該筆及照片；另一台手機上傳也能收到。
   - 未授權帳號不能讀清單／圖片；匿名不能直接列出、讀取 Storage 檔案。
   - 上傳三張、超大照片、無效 CAPTCHA、異常網路狀態均給出適當回應。
   - 測試標記處理、刪除照片與紀錄，並確認未留下公開連結。

## 建議加入既有 index.html 的入口

把以下連結放在慢箋寄單區塊，**待正式驗收後**再對顧客開放：

```html
<a href="upload.html">📷 手機拍照傳送慢箋</a>
```

藥局電腦專用：`https://yuyao62.github.io/Wei-Yuan-Community-Pharmacy/inbox.html`（此為預計部署路徑，尚未上線驗證）。

## 重要安全／維護說明

- 本範本做了私人儲存、RLS、後端人機驗證、管理員登入與原始圖片重編碼；**不等於已達成正式醫療個資系統的法規或資安認證**。
- 需由藥局確認個資法及相關醫事法規、蒐集告知、資料存放地區、保留期限、備份、存取紀錄、事故應變、供應商合約、員工權限與 MFA。
- 資料目前**不會自動到期刪除**；請設訂保存期限並規劃例行清理，還要檢查備份中的個資。Cloudflare Turnstile 防止一部分機器濫用，但仍應為正式網站額外部署後端速率限制、流量與費用監控。
- 裝置網路中斷時，客人可看到失敗訊息；如果回應遺失，即使後端已完成收件也可能顯示失敗，因此應先跟藥局確認是否已有相同處方再重送。
- 處方影像若內含患者識別或健康資訊，不能以普通 GitHub 儲存庫、公開 Bucket、公開 Google Drive 等方式保存。
- `inbox.html` 的網址不是密碼保護，但收件內容是透過 Supabase 帳號及資料庫／儲存權限保護；不要只依賴把網址藏起來。
- 不建議把 `inbox.html` 連結公開放進首頁導航；藥局人員可直接收藏網址。

## 內容檔案

- `upload.html` / `upload.js`: 手機拍照及上傳
- `inbox.html` / `inbox.js`: 藥局登入收件
- `privacy.html`: 上線前應確認的個資告知草案
- `styles.css`: 手機／電腦自適應樣式
- `config.js`: 公開配置（預設無法送出）
- `schema.sql`: 私人照片儲存及 RLS 權限設定
- `supabase/config.toml`: Edge Function JWT 行為
- `supabase/functions/submit-prescription/index.ts`: CAPTCHA 驗證與安全上傳 API
