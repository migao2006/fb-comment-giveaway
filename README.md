# FB 留言抽獎

在 Facebook 一般貼文頁執行的 Bookmarklet。只載入主留言，可查看、搜尋、下載 CSV 並抽獎；不展開或保存回覆。

安裝頁：https://migao2006.github.io/fb-comment-giveaway/

## 使用

1. 在 iPhone Safari 將安裝頁加入書籤。
2. 複製書籤程式，貼到書籤的網址欄。
3. 開啟 Facebook 一般貼文，把留言排序改成「所有留言」。
4. 執行書籤，按「載入全部主留言」。
5. 下載 CSV 或設定條件後抽獎。

工具只讀取目前頁面已渲染的 DOM，資料不會上傳。Facebook 顯示的留言總數可能包含回覆，因此不作為主留言完成數量。

## 開發

需要 Node.js 22 以上版本。

```bash
npm ci
npm run check
npm test
npm run build
```

建置輸出位於 `dist/`。本專案與 Meta 或 Facebook 無關。
