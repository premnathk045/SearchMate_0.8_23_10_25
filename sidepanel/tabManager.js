export function createTabElement(tab) {
    const li = document.createElement('li');
    li.className = 'tab-item flex items-center gap-3 p-2 rounded-lg text-sm text-gray-700 cursor-pointer transition-colors duration-150 hover:bg-blue-50';
    li.dataset.tabId = tab.id;
    li.dataset.url = tab.url || ''; // Store URL safely

    let faviconUrl;

    // Safely determine favicon URL
    if (tab.favicon && tab.favicon.startsWith('http')) {
        faviconUrl = tab.favicon;
    } else {
        try {
            const hostname = new URL(tab.url).hostname;
            faviconUrl = `https://www.google.com/s2/favicons?domain=${hostname}&sz=32`;
        } catch (e) {
            faviconUrl = "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHRleHQgeT0iLjllbSIgZm9udC1zaXplPSI5MCI+🔖</dGV4dD48L3N2Zz4=";
        }
    }

    li.innerHTML = `
        <img src="${faviconUrl}" 
            class="tab-favicon w-5 h-5 object-contain flex-shrink-0 rounded-sm"
            onerror="this.onerror=null;this.src='data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHRleHQgeT0iLjllbSIgZm9udC1zaXplPSI5MCI+🔖</dGV4dD48L3N2Zz4='">
        <span class="tab-title text-sm truncate">${tab.title || 'Untitled Tab'}</span>
    `;

    // click event to open group link in new tab
    li.addEventListener('click', () => handleTabClick(tab, li));

    return li;
}

export function handleTabClick(tab, tabElement) {
    // Open the tab without removing it from the list
    chrome.runtime.sendMessage({
        action: "openTab",
        tabId: tab.id,
        url: tab.url
    }, () => {
        // Highlight the clicked tab
        highlightActiveTab(tabElement);
    });
}

// Highlight active tab
export function highlightActiveTab(activeTabElement) {
    // Remove highlight from previously active tab
    const previouslyActive = document.querySelector('.tab-item.active');
    if (previouslyActive) {
        previouslyActive.classList.remove('active', 'bg-blue-100', 'font-semibold');
    }

    // Add highlight to the new active tab
    if (activeTabElement) {
        activeTabElement.classList.add('active', 'bg-blue-100', 'font-semibold');
        let parentContainer = activeTabElement.closest('.tab-group-cont.hidden, .tab-subgroup-cont.hidden');
        if (parentContainer) {
            let subgroupHeader = parentContainer.previousElementSibling;
            if (subgroupHeader && subgroupHeader.classList.contains('tab-subgroup-header')) {
                subgroupHeader.click();
            }
            let groupHeader = activeTabElement.closest('.tab-group-item')?.querySelector('.tab-group-header');
            if (groupHeader && activeTabElement.closest('.tab-group-cont.hidden')) {
                groupHeader.click();
            }
        }
        activeTabElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
}
