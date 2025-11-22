document.addEventListener('DOMContentLoaded', function() {
    document.getElementById('toggleSidebar').addEventListener('click', function() {
        chrome.sidePanel.open();
    });

    document.getElementById('organizeTabs').addEventListener('click', function() {
        chrome.runtime.sendMessage({action: "organizeTabs"});
    });
});