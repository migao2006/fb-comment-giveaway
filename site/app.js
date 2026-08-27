const button = document.querySelector("#copy-bookmarklet");
const state = button?.querySelector(".button-state");

async function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.append(area);
  area.select();
  const copied = document.execCommand("copy");
  area.remove();
  if (!copied) throw new Error("copy_failed");
}

button?.addEventListener("click", async () => {
  const bookmarklet = globalThis.FB_COMMENT_GIVEAWAY_BOOKMARKLET;
  if (!bookmarklet) {
    state.textContent = "尚未完成建置";
    return;
  }
  try {
    await copyText(bookmarklet);
    button.classList.add("copied");
    state.textContent = "已複製";
    setTimeout(() => {
      button.classList.remove("copied");
      state.textContent = "";
    }, 2400);
  } catch {
    state.textContent = "複製失敗，請下載文字版";
  }
});
