# FB 留言抽獎書籤

不用安裝 App 或瀏覽器擴充套件。在 Facebook 一般貼文頁執行 Bookmarklet，工具會直接從目前頁面整理主留言與回覆，並在裝置本機完成完整留言匯出、篩選與抽獎。

**安裝頁：** https://migao2006.github.io/fb-comment-giveaway/

## 使用方式

1. 在 iPhone Safari 開啟安裝頁，建立一個名為「FB 留言抽獎」的書籤。
2. 按安裝頁的「複製書籤程式」，編輯剛才的書籤，把網址完整換成複製的 `javascript:` 內容。
3. 用 Safari 登入 Facebook，開啟一般貼文並把留言排序切換成「所有留言」。
4. 點選「FB 留言抽獎」書籤，按「載入全部留言」。
5. 在「完整留言」查看、搜尋或下載 CSV 原始留言資料。
6. 設定關鍵字、日期、排除貼文作者、正取及備取人數後開始抽獎。

## 功能

- 半自動展開更多主留言、回覆與被截斷的留言全文，顯示進度並可隨時停止。
- 分開保存主留言與回覆；抽獎條件不會修改或刪除完整原始留言資料。
- 取得頁面中可見的姓名、完整留言內容、個人頁連結、回覆對象及可取得的時間、留言連結與圖片／貼圖資訊。
- 可在工具內搜尋完整留言並下載 UTF-8 CSV；iPhone Safari 會開啟原生分享面板，可選擇「儲存到檔案」。
- 載入結果分為「已驗證完整」、「可見留言已載完」與「部分資料」；未能和 Facebook 顯示總數核對時，匯出檔名及內容會標記 `partial`，且抽獎前會再次確認。
- 預設每個帳號只有一次資格，並統計重複留言者。
- 支援關鍵字、日期、排除貼文作者、正取、備取與重新抽獎。
- 使用 Web Crypto 安全亂數，不使用 `Math.random()`。
- 可匯出去識別化抽獎紀錄；完整名單必須另行確認後才能下載。
- 完全自包含的 Bookmarklet，執行時不下載外部程式。

## 隱私與安全

工具只解析瀏覽器目前已渲染的 DOM，不讀取或上傳 Facebook 密碼、Cookie、Access Token 或隱藏 API 回應。沒有分析工具、後端服務或遠端資料庫。Facebook 文字一律以文字節點呈現，不當作 HTML 執行。

完整名單包含個人資料，請只在具有合法目的時匯出、妥善保存並於不再需要時刪除。此工具不會繞過 Facebook 的登入、權限、速率限制或反自動化機制。

## 支援範圍與限制

- 第一版以繁體中文 Facebook 的使用者、粉專及社團「一般貼文」為驗收範圍。
- 只抽主留言；回覆可能被辨識並統計，但不列入候選名單。
- 只能取得使用者目前有權查看、且已載入或工具成功展開的留言。
- Facebook 顯示的留言總數可能包含無權查看、遭刪除、被系統隱藏或尚未提供到 DOM 的項目；工具不會把這類差額偽裝成已讀取留言。
- 若 Facebook 沒有在 DOM 提供作者個人頁連結，工具會按留言分開計算並顯示警告，避免把同名的不同人錯誤合併；此時無法保證「每個帳號一次」。
- 不承諾支援 Reels、直播、相片檢視器或 Facebook 後續推出的新頁型。
- Facebook DOM 會改版。若解析失效，請使用 [解析問題回報](https://github.com/migao2006/fb-comment-giveaway/issues/new?template=parser-bug.yml)，不要附上 Cookie、Token、完整頁面 HTML 或未遮蔽的個人資料。

## 本機開發

需要 Node.js 22 以上版本。

```bash
npm ci
npm run check
npm test
npm run build
```

建置產物位於 `dist/`：

- `bookmarklet.txt`：可直接貼入書籤網址欄的完整程式。
- `index.html`：GitHub Pages 安裝說明。
- `bookmarklet.js`：方便檢查的壓縮後程式碼。

`npm run dev` 會監看 Bookmarklet 程式碼；靜態安裝頁可用任意本機 HTTP server 預覽 `dist/`。

## 專案結構

- `src/parser.ts`：Facebook DOM 語意解析與診斷。
- `src/loader.ts`：保守的半自動留言載入流程。
- `src/raffle.ts`：篩選、去重、安全亂數與抽獎證明。
- `src/bookmarklet.ts`：手機頁內浮動介面。
- `site/`：安裝說明頁。
- `tests/`：去識別 DOM fixtures 與核心測試。

## 免責聲明

本專案與 Meta 或 Facebook 無關，亦未獲其背書。使用者應自行確認抽獎活動、資料處理及平台使用方式符合所在地法規與 Facebook 規範。

MIT License
