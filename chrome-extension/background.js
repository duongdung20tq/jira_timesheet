const JIRA = 'https://jira.fis.com.vn/';

// Bấm icon extension: đang ở Jira thì mở/đóng bảng khai, nếu không thì mở Jira.
chrome.action.onClicked.addListener((tab) => {
  if (tab.url && tab.url.startsWith(JIRA)) {
    chrome.tabs.sendMessage(tab.id, { type: 'toggle' }).catch(() => chrome.tabs.reload(tab.id));
  } else {
    chrome.tabs.create({ url: JIRA + 'secure/Dashboard.jspa' });
  }
});
