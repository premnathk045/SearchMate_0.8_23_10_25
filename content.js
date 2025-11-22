let sidebar;

function handleRuntimeError() {
    if (chrome.runtime.lastError) {
        console.warn('Extension context invalidated:', chrome.runtime.lastError.message);
        // Remove event listeners and clean up
        if (sidebar) {
            sidebar.remove();
        }
        // Remove any other event listeners or intervals here
    }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    handleRuntimeError();
    if (request.action === "updateSidebar") {
        updateSidebar(request.visible);
        sendResponse({status: "success"});
    }
    return true;
});

function updateSidebar(visible) {
    handleRuntimeError();
    if (visible) {
        if (!sidebar) {
            injectSidebar();
        } else {
            sidebar.style.display = 'block';
        }
    } else {
        if (sidebar) {
            sidebar.style.display = 'none';
        }
    }
}

function injectSidebar() {
    handleRuntimeError();
    if (isRestrictedUrl(window.location.href)) {
        console.warn("Cannot inject sidebar on restricted URL");
        return;
    }

    fetch(chrome.runtime.getURL('sidebar.html'))
        .then(response => response.text())
        .then(data => {
            sidebar = document.createElement('div');
            sidebar.id = 'extension-sidebar';
            sidebar.innerHTML = data;
            document.body.appendChild(sidebar);
            
            // Add event listeners to sidebar elements
            const organizeBtn = document.getElementById('organize');
            if (organizeBtn) {
                organizeBtn.addEventListener('click', organizeTabs);
            }
            updateTabList();

            // Inject styles
            const link = document.createElement('link');
            link.href = chrome.runtime.getURL('styles.css');
            link.type = 'text/css';
            link.rel = 'stylesheet';
            document.head.appendChild(link);
        })
        .catch(error => {
            console.error('Error injecting sidebar:', error);
        });
}

// Check sidebar state when the content script loads
chrome.storage.local.get(['sidebarVisible'], (result) => {
    handleRuntimeError();
    if (result.sidebarVisible) {
        injectSidebar();
    }
});

function organizeTabs() {
    handleRuntimeError();
    chrome.runtime.sendMessage({action: "organizeTabs"}, () => {
        updateTabList();
    });
}

function updateTabList() {
    handleRuntimeError();
    const tabList = document.getElementById('tab-list');
    if (!tabList) return;

    tabList.innerHTML = '';
    chrome.runtime.sendMessage({action: "getClosedTabs"}, (response) => {
        if (chrome.runtime.lastError) {
            console.warn('Error getting closed tabs:', chrome.runtime.lastError.message);
            return;
        }
        if (response && response.groupedTabs) {
            renderGroupedTabs(response.groupedTabs);
        }
    });
}

function renderGroupedTabs(groupedTabs) {
    const tabList = document.getElementById('tab-list');
    if (!tabList) return;

    tabList.innerHTML = '';

    // Render grouped tabs
    groupedTabs.groups.forEach(group => {
        const groupElement = createGroupElement(group);
        tabList.appendChild(groupElement);
    });

    // Render ungrouped tabs
    if (groupedTabs.ungrouped.length > 0) {
        const ungroupedElement = createGroupElement({
            id: 'ungrouped',
            title: 'Other',
            tabs: groupedTabs.ungrouped
        });
        tabList.appendChild(ungroupedElement);
    }
}

function createGroupElement(group) {
    const groupElement = document.createElement('li');
    groupElement.className = 'tab-group';
    groupElement.innerHTML = `
        <div class="group-header">
            <span class="group-title">${group.title}</span>
            <span class="group-count">(${group.tabs.length})</span>
        </div>
        <ul class="group-tabs"></ul>
    `;

    const groupTabs = groupElement.querySelector('.group-tabs');
    group.tabs.forEach(tab => {
        const tabElement = createTabElement(tab);
        groupTabs.appendChild(tabElement);
    });

    groupElement.querySelector('.group-header').addEventListener('click', () => {
        groupElement.classList.toggle('expanded');
    });

    return groupElement;
}

function createTabElement(tab) {
    const li = document.createElement('li');
    li.className = 'tab-item';
    li.textContent = tab.title;
    if (tab.favicon) {
        const favicon = document.createElement('img');
        favicon.src = tab.favicon;
        favicon.className = 'tab-favicon';
        li.prepend(favicon);
    }
    li.addEventListener('click', () => {
        handleRuntimeError();
        chrome.runtime.sendMessage({
            action: "openAndRemoveTab", 
            tabId: tab.id, 
            url: tab.url
        }, () => {
            if (chrome.runtime.lastError) {
                console.warn('Error opening and removing tab:', chrome.runtime.lastError.message);
                return;
            }
            li.remove();
        });
    });
    return li;
}

function clearAllStoredTabs() {
    handleRuntimeError();
    chrome.runtime.sendMessage({action: "clearAllStoredTabs"}, () => {
        updateTabList();
    });
}

function isRestrictedUrl(url) {
    return url.startsWith('chrome://') || 
           url.startsWith('https://chrome.google.com/webstore') ||
           url.startsWith('chrome-extension://') ||
           url.startsWith('chrome://extensions');
}

// Add an error listener to handle extension updates or reloads
chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
    handleRuntimeError();
});