// Toolbar click → ask the page to toggle PiP. Chrome may refuse because the
// click happened outside the page (no user activation there); the content
// script then shows a hint to use the in-page button or Alt+Shift+P instead.
chrome.action.onClicked.addListener((tab) => {
  if (tab.id === undefined) return;
  chrome.tabs.sendMessage(tab.id, { type: 'pipc:toggle' }).catch(() => {});
});
