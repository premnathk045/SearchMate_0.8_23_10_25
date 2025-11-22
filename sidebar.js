document.addEventListener('DOMContentLoaded', () => {
    const organizeBtn = document.getElementById('organize');
    const clearAllBtn = document.getElementById('clear-all');
    const tabList = document.getElementById('tab-list');

    organizeBtn.addEventListener('click', organizeTabs);
    clearAllBtn.addEventListener('click', clearAllStoredTabs);

    function organizeTabs() {
        chrome.runtime.sendMessage({action: "organizeTabs"}, () => {
            updateTabList();
        });
    }

    function clearAllStoredTabs() {
        chrome.runtime.sendMessage({action: "clearAllStoredTabs"}, () => {
            updateTabList();
        });
    }

    function updateTabList() {
        chrome.runtime.sendMessage({action: "getClosedTabs"}, (response) => {
            if (response && response.groupedTabs) {
                renderGroupedTabs(response.groupedTabs);
            }
        });
    }

    function renderGroupedTabs(groupedTabs) {
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
            chrome.tabs.create({ url: tab.url });
            chrome.runtime.sendMessage({action: "removeFromClosedTabs", tabId: tab.id});
            li.remove();
        });
        return li;
    }

    // Initial load of stored tabs
    updateTabList();
});