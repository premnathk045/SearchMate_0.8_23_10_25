document.addEventListener('DOMContentLoaded', () => {
    const organizeBtn = document.getElementById('organize');
    const searchInput = document.getElementById('default-search');
    const tabGroupList = document.getElementById('tab-group-list');
    const loadingMessage = document.getElementById('loading-message'); // Add a loading message element in your HTML

    // Ensure we have a place to display messages
    if (!loadingMessage) {
        console.error("Missing #loading-message element in HTML.");
    }

    // Load Sortable.js if it's not already loaded (assuming your HTML loads it)
    // <script src="https://cdn.jsdelivr.net/npm/sortablejs@1.15.0/Sortable.min.js"></script>

    organizeBtn.addEventListener('click', organizeTabs);
    searchInput.addEventListener('input', searchTabs);

    // Close dropdowns when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.group-menu-btn') && !e.target.closest('.subgroup-menu-btn')) {
            closeAllDropdowns();
        }
    });

    // Add this listener for messages from the background script
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === "updateActiveTab") {
            updateHighlightedTab(request.tabId, request.url, request.title);
        }
    });

    // Add listener for refresh messages
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === "refreshSidepanel") {
            updateTabList(false, true); // Force refresh without regrouping
        }
    });

    // Listen for tab group updates
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === "tabGroupUpdated") {
            console.log('Received tabGroupUpdated message');
            // Update the UI with the new grouped tabs data
            renderGroupedTabs(request.groupedTabs);
        }
    });

    // Listen for changes to chrome.storage
    chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace === 'local' && changes.searchmate_groupedTabs) {
            // Storage was updated, refresh the UI
            updateTabList(false, true);
        }
    });

    function organizeTabs() {
        chrome.runtime.sendMessage({
            action: "organizeTabs"
        }, () => {
            // Force regroup after organizing
            updateTabList(true);
        });
    }

    function searchTabs(event) {
        const searchTerm = event.target.value.toLowerCase();
        const tabItems = document.querySelectorAll('.tab-item');
        
        tabItems.forEach(item => {
            // Check title and URL text content for search term
            const tabText = (item.querySelector('.tab-title')?.textContent + item.dataset.url).toLowerCase();
            if (tabText.includes(searchTerm)) {
                item.style.display = 'flex';
                // Show parent subgroups/groups if a child tab is found
                let parent = item.closest('.tab-subgroup-cont');
                if (parent) parent.classList.remove('hidden');
                
                let grandparent = item.closest('.tab-group-cont');
                if (grandparent) grandparent.classList.remove('hidden');

            } else {
                item.style.display = 'none';
            }
        });
    }

    // Initialize Lottie animation
    let animation = null;

    // Load Lottie library locally
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('assets/libs/lottie.min.js');
    document.head.appendChild(script);

    script.onload = () => {
        fetch(chrome.runtime.getURL('assets/loader/Ai Logo.json'))
            .then(response => response.json())
            .then(animationData => {
                animation = lottie.loadAnimation({
                    container: document.getElementById('lottie-animation'),
                    renderer: 'svg',
                    loop: true,
                    autoplay: false,
                    animationData: animationData
                });
            });
    };

    async function updateTabList(forceRegroup = false, forceRefresh = false) {
        const loadingContainer = document.getElementById('loading-container');
        const tabGroupContainer = document.getElementById('tab-group-container');
        
        // Show loading animation
        loadingContainer.classList.remove('hidden');
        tabGroupContainer.classList.add('hidden');
        if (animation) animation.play();

        try {
            const response = await new Promise((resolve, reject) => {
                chrome.runtime.sendMessage({
                    action: "getClosedTabs",
                    forceRegroup: forceRegroup,
                    forceRefresh: forceRefresh
                }, (res) => {
                    if (chrome.runtime.lastError) {
                        return reject(chrome.runtime.lastError);
                    }
                    resolve(res);
                });
            });

            // Hide loading animation
            loadingContainer.classList.add('hidden');
            tabGroupContainer.classList.remove('hidden');
            if (animation) animation.stop();

            if (response && response.groupedTabs) {
                renderGroupedTabs(response.groupedTabs);
            } else {
                console.error('No groupedTabs found in response:', response);
                showEmptyState();
            }
        } catch (error) {
            console.error('Error fetching grouped tabs:', error);
            // Hide loading animation on error
            loadingContainer.classList.add('hidden');
            tabGroupContainer.classList.remove('hidden');
            if (animation) animation.stop();
            showEmptyState();
        }
    }

    function initializeSortable() {
        console.log('Initializing Sortable...'); // Debug log
        
        if (typeof Sortable === 'undefined') {
            console.error('Sortable library is not loaded. Please ensure you include Sortable.min.js in your sidepanel.html.');
            return;
        }

        try {
            // Destroy existing sortable instances to prevent duplicates
            if (tabGroupList.sortable) tabGroupList.sortable.destroy();
            document.querySelectorAll('.tab-group-cont, .tab-subgroup-cont').forEach(el => {
                if (el.sortable) el.sortable.destroy();
            });

            // Initialize main tab group list
            tabGroupList.sortable = Sortable.create(tabGroupList, {
                group: 'tab-groups',
                animation: 150,
                handle: '.tab-group-header', // Changed handle to header for easier drag
                fallbackOnBody: true,
                invertSwap: true,
                swapThreshold: 0.65,
                ghostClass: 'sortable-ghost',
                chosenClass: 'sortable-chosen',
                dragClass: 'sortable-drag',
                onEnd: function() {
                    saveTabOrder();
                }
            });

            // Initialize all tab group containers
            document.querySelectorAll('.tab-group-cont').forEach((groupCont) => {
                groupCont.sortable = Sortable.create(groupCont, {
                    group: { name: 'shared-tabs', pull: true, put: true },
                    animation: 150,
                    fallbackOnBody: true,
                    invertSwap: true,
                    swapThreshold: 0.65,
                    ghostClass: 'sortable-ghost',
                    chosenClass: 'sortable-chosen',
                    dragClass: 'sortable-drag',
                    onEnd: function() {
                        saveTabOrder();
                    }
                });
            });

            // Initialize all subgroup containers
            document.querySelectorAll('.tab-subgroup-cont').forEach((subgroupCont) => {
                subgroupCont.sortable = Sortable.create(subgroupCont, {
                    group: { name: 'shared-tabs', pull: true, put: true },
                    animation: 150,
                    fallbackOnBody: true,
                    invertSwap: true,
                    swapThreshold: 0.65,
                    ghostClass: 'sortable-ghost',
                    chosenClass: 'sortable-chosen',
                    dragClass: 'sortable-drag',
                    onEnd: function() {
                        saveTabOrder();
                    }
                });
            });

            // Add CSS for drag and drop visual feedback
            addDragDropStyles();

        } catch (error) {
            console.error('Error initializing Sortable:', error);
        }
    }

    function addDragDropStyles() {
        if (document.getElementById('drag-drop-styles')) return;

        const style = document.createElement('style');
        style.id = 'drag-drop-styles';
        style.textContent = `
            .sortable-ghost {
                opacity: 0.4;
                background: #e0f2fe !important; /* Light blue ghost */
                border: 1px dashed #38bdf8;
                border-radius: 0.75rem;
            }
            
            .sortable-chosen {
                background: #bfdbfe;
                box-shadow: 0 4px 6px rgba(0,0,0,0.1);
            }
            
            .sortable-drag {
                background: #FFFFFF;
                box-shadow: 0 8px 16px rgba(0,0,0,0.2);
            }

            .tab-group-item, .tab-subgroup-item, .tab-item {
                cursor: grab;
            }

            .tab-group-item:active, .tab-subgroup-item:active, .tab-item:active {
                cursor: grabbing;
            }
        `;
        document.head.appendChild(style);
    }

    function renderGroupedTabs(groupedTabs) {
        // Get collapsed view preference first
        chrome.storage.local.get(['collapsedView'], (result) => {
            const shouldCollapse = result.collapsedView || false;
            
            tabGroupList.innerHTML = '';

            // Check if there are no tabs to display
            const hasNoTabs = (!groupedTabs.groups || groupedTabs.groups.length === 0) && 
                             (!groupedTabs.ungrouped || groupedTabs.ungrouped.length === 0);

            if (hasNoTabs) {
                showEmptyState();
                return;
            }

            // Render main groups
            if (Array.isArray(groupedTabs.groups)) {
                groupedTabs.groups.forEach(group => {
                    if (group && group.title && Array.isArray(group.subgroups)) {
                        const groupElement = createGroupElement(group, false, shouldCollapse);
                        tabGroupList.appendChild(groupElement);
                    } else {
                        console.error('Invalid group structure:', group);
                    }
                });
            }

            // Render ungrouped section
            if (groupedTabs.ungrouped && groupedTabs.ungrouped.length > 0) {
                const ungroupedGroup = {
                    id: 'ungrouped',
                    title: 'Other Tabs',
                    subgroups: [{
                        title: 'Miscellaneous',
                        tabs: groupedTabs.ungrouped
                    }]
                };
                const ungroupedElement = createGroupElement(ungroupedGroup, true, shouldCollapse);
                tabGroupList.appendChild(ungroupedElement);
            }

            // Re-initialize sortable after rendering all elements
            initializeSortable();
        });
    }

    function showEmptyState() {
        const tabGroupContainer = document.getElementById('tab-group-container');
        tabGroupContainer.innerHTML = `
            <div class="flex flex-col items-center justify-center h-[70vh] px-4 mt-32">
                <div id="empty-box-animation" class="w-40 h-40 mb-4"></div>
                <p class="text-center text-gray-500 text-sm max-w-xs">
                    Looks like your browser's in chaos! Hit 'Organize' and let AI sort it all out while you sit back and chill.
                </p>
            </div>
        `;

        // Initialize Lottie animation for empty state
        fetch(chrome.runtime.getURL('assets/loader/Empty Box.json'))
            .then(response => response.json())
            .then(animationData => {
                lottie.loadAnimation({
                    container: document.getElementById('empty-box-animation'),
                    renderer: 'svg',
                    loop: true,
                    autoplay: true,
                    animationData: animationData
                });
            })
            .catch(error => console.error('Error loading empty state animation:', error));
    }

    function createGroupElement(group, isUngrouped = false, isCollapsed = false) {
        const groupElement = document.createElement('li');
        groupElement.className = 'tab-group-item bg-white p-2 rounded-xl shadow-md border border-slate-100';
        groupElement.dataset.groupId = group.id || generateId();
        
        groupElement.innerHTML = `
            <div class="tab-group-header p-2 rounded-lg shadow-sm flex items-center justify-between transition-colors duration-200 hover:bg-slate-100">
                <div class="group-header-left flex items-center gap-3 w-full">
                    <div class="header-toggle-arrow transition-transform duration-300" style="transform: rotate(0deg);">
                        <div class="bg-transparent flex justify-center items-center rounded-full w-6 h-6 hover:bg-slate-200">
                            <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 1024 1024"><path fill="#636363" d="M831.872 340.864L512 652.672L192.128 340.864a30.59 30.59 0 0 0-42.752 0a29.12 29.12 0 0 0 0 41.6L489.664 714.24a32 32 0 0 0 44.672 0l340.288-331.712a29.12 29.12 0 0 0 0-41.728a30.59 30.59 0 0 0-42.752 0z"/></svg>
                        </div>
                    </div>
                    <span class="group-title text-base font-semibold text-slate-700 truncate">${group.title}</span>
                </div>
                <div class="group-header-right relative">
                    <button class="group-menu-btn bg-transparent flex justify-center items-center rounded-full w-6 h-6 hover:bg-slate-200">
                        <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 256 256"><path fill="#4F4F4F" d="M140 128a12 12 0 1 1-12-12a12 12 0 0 1 12 12m-12-56a12 12 0 1 0-12-12a12 12 0 0 0 12 12m0 112a12 12 0 1 0 12 12a12 12 0 0 0-12-12"/></svg>
                    </button>
                    <div class="group-dropdown hidden absolute right-0 top-full mt-1 w-40 bg-white rounded-md shadow-lg border border-gray-200 z-50">
                        <ul class="py-1">
                            <li><button class="w-full px-4 py-2 text-left text-sm hover:bg-slate-50">Open in Group</button></li>
                            <li><button class="w-full px-4 py-2 text-left text-sm hover:bg-slate-50">Delete Tab Group</button></li>
                            <li><button class="w-full px-4 py-2 text-left text-sm hover:bg-slate-50">AI Summarize</button></li>
                        </ul>
                    </div>
                </div>
            </div>
            <ul class="tab-group-cont mt-2 flex flex-col gap-1"></ul>
        `;

        // Add dropdown toggle functionality
        const menuBtn = groupElement.querySelector('.group-menu-btn');
        const dropdown = groupElement.querySelector('.group-dropdown');
        
        menuBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            closeAllDropdowns();
            dropdown.classList.toggle('hidden');
        });

        // Add click handlers for dropdown options
        const dropdownButtons = dropdown.querySelectorAll('button');
        dropdownButtons[0].addEventListener('click', () => handleGroupAction('open', group));
        dropdownButtons[1].addEventListener('click', () => handleGroupAction('delete', group));
        dropdownButtons[2].addEventListener('click', () => handleGroupAction('summarize', group));

        const tabGroupCont = groupElement.querySelector('.tab-group-cont');
        const toggleArrow = groupElement.querySelector('.header-toggle-arrow');
        const tabGroupHeader = groupElement.querySelector('.tab-group-header');

        // Apply initial collapsed state based on setting
        if (isCollapsed) {
            tabGroupCont.classList.add('hidden');
            toggleArrow.style.transform = 'rotate(0deg)';
            tabGroupHeader.classList.add('bg-slate-50');
        }

        // Apply the same collapsed state to subgroups
        if (Array.isArray(group.subgroups)) {
            group.subgroups.forEach(subgroup => {
                if (subgroup.tabs && Array.isArray(subgroup.tabs)) {
                    if (subgroup.tabs.length === 1 && !isUngrouped) {
                        // Single tab: add directly to group container
                        const tabElement = createTabElement(subgroup.tabs[0]);
                        tabGroupCont.appendChild(tabElement);
                    } else {
                        // Subgroup or single tab in "Ungrouped" section: create a subgroup element
                        const subgroupElement = createSubgroupElement(subgroup, isCollapsed);
                        tabGroupCont.appendChild(subgroupElement);
                    }
                }
            });
        }
        
        // Initial state: collapse all groups
        if (tabGroupCont.classList.contains('hidden')) {
            toggleArrow.style.transform = 'rotate(-90deg)';
            tabGroupHeader.classList.add('bg-slate-50');
        }

        tabGroupHeader.addEventListener('click', (e) => {
            // Check if the click was on the group header but not an interactive element within
            if (e.target.closest('.group-header-left') || e.target.closest('.group-header-right')) {
                tabGroupCont.classList.toggle('hidden');
                toggleArrow.style.transform = tabGroupCont.classList.contains('hidden') ? 'rotate(0deg)' : 'rotate(-90deg)';
                tabGroupHeader.classList.toggle('bg-slate-50');
                tabGroupHeader.classList.toggle('bg-slate-100');
            }
        });

        return groupElement;
    }

    function createSubgroupElement(subgroup, isCollapsed = false) {
        const subgroupElement = document.createElement('li');
        subgroupElement.className = 'tab-subgroup-item bg-gray-50 p-1 rounded-xl border border-gray-200 shadow-sm ml-2';
        subgroupElement.dataset.subgroupId = generateId();
        subgroupElement.innerHTML = `
            <div class="tab-subgroup-header p-1 rounded-md flex items-center justify-between cursor-pointer hover:bg-gray-100">
                <div class="subgroup-header-left flex items-center gap-2 w-full overflow-hidden">
                    <div class="subheader-toggle-arrow transition-transform duration-300 flex-shrink-0" style="transform: rotate(0deg);">
                        <div class="bg-transparent flex justify-center items-center rounded-full w-5 h-5 hover:bg-gray-200">
                            <svg xmlns="http://www.w3.org/2000/svg" width="0.8em" height="0.8em" viewBox="0 0 1024 1024"><path fill="#636363" d="M831.872 340.864L512 652.672L192.128 340.864a30.59 30.59 0 0 0-42.752 0a29.12 29.12 0 0 0 0 41.6L489.664 714.24a32 32 0 0 0 44.672 0l340.288-331.712a29.12 29.12 0 0 0 0-41.728a30.59 30.59 0 0 0-42.752 0z"></path></svg>
                        </div>
                    </div>
                    <span class="subgroup-title text-sm font-medium text-slate-600 flex-1 truncate">${subgroup.title} (${subgroup.tabs.length})</span>
                </div>
                <div class="subgroup-header-right relative">
                    <button class="subgroup-menu-btn bg-transparent flex justify-center items-center rounded-full w-5 h-5 hover:bg-gray-200">
                        <svg xmlns="http://www.w3.org/2000/svg" width="0.8em" height="0.8em" viewBox="0 0 256 256"><path fill="#4F4F4F" d="M140 128a12 12 0 1 1-12-12a12 12 0 0 1 12 12m-12-56a12 12 0 1 0-12-12a12 12 0 0 0 12 12m0 112a12 12 0 1 0 12 12a12 12 0 0 0-12-12"/></svg>
                    </button>
                    <div class="subgroup-dropdown absolute hidden right-0 top-full mt-1 w-40 bg-white rounded-md shadow-lg border border-gray-200 z-50">
                        <ul class="py-1">
                            <li><button class="w-full px-4 py-2 text-left text-sm hover:bg-slate-50">Open in Group</button></li>
                            <li><button class="w-full px-4 py-2 text-left text-sm hover:bg-slate-50">Delete Tab Group</button></li>
                            <li><button class="w-full px-4 py-2 text-left text-sm hover:bg-slate-50">AI Summarize</button></li>
                        </ul>
                    </div>
                </div>
            </div>
            <ul class="tab-subgroup-cont ml-3 mt-1 flex flex-col gap-1"></ul>
        `;

        // Add dropdown toggle functionality
        const menuBtn = subgroupElement.querySelector('.subgroup-menu-btn');
        const dropdown = subgroupElement.querySelector('.subgroup-dropdown');
        
        menuBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            closeAllDropdowns();
            dropdown.classList.toggle('hidden');
        });

        // Add click handlers for dropdown options
        const dropdownButtons = dropdown.querySelectorAll('button');
        dropdownButtons[0].addEventListener('click', () => handleSubgroupAction('open', subgroup));
        dropdownButtons[1].addEventListener('click', () => handleSubgroupAction('delete', subgroup));
        dropdownButtons[2].addEventListener('click', () => handleSubgroupAction('summarize', subgroup));

        const tabSubgroupCont = subgroupElement.querySelector('.tab-subgroup-cont');
        subgroup.tabs.forEach(tab => {
            const tabElement = createTabElement(tab);
            tabSubgroupCont.appendChild(tabElement);
        });

        const toggleArrow = subgroupElement.querySelector('.subheader-toggle-arrow');
        const tabSubgroupHeader = subgroupElement.querySelector('.tab-subgroup-header');

        // Apply initial collapsed state based on setting
        if (isCollapsed) {
            tabSubgroupCont.classList.add('hidden');
            toggleArrow.style.transform = 'rotate(0deg)';
        }

        tabSubgroupHeader.addEventListener('click', () => {
            tabSubgroupCont.classList.toggle('hidden');
            toggleArrow.style.transform = tabSubgroupCont.classList.contains('hidden') ? 'rotate(0deg)' : 'rotate(-90deg)';
        });

        return subgroupElement;
    }

    // function createTabElement(tab) {
    //     const li = document.createElement('li');
    //     li.className = 'tab-item flex items-center gap-3 p-2 rounded-lg text-sm text-gray-700 cursor-pointer transition-colors duration-150 hover:bg-blue-50';
    //     li.dataset.tabId = tab.id;
    //     li.dataset.url = tab.url; // Store URL for search functionality

    //     // Fallback for missing favicon
    //     const faviconUrl = tab.favicon && tab.favicon.startsWith('http') ? tab.favicon : `https://www.google.com/s2/favicons?domain=${new URL(tab.url).hostname}&sz=32`;

    //     li.innerHTML = `
    //         <img src="${faviconUrl}" onerror="this.onerror=null;this.src='data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxZW0iIGhlaWdodD0iMWVtIiB2aWV3Qm94PSIwIDAgMjQgMjQiPjxwYXRoIGZpbGw9IiM2Mzc0ODkiIGQ9Ik0zIDExaDIuMjVhLjI1LjI1IDAgMCAxIC4yNS4yNXYxLjVhLjI1LjI1IDAgMCAxLS4yNS4yNUgzdi0yem01LTMuMjVoMS41YTQuMjUgNC4yNSAwIDAgMSAwIDguNVg4VjguNTVhLjc1Ljc1IDAgMCAwLS43NS0uNzVhNC41IDQuNSAwIDAgMC00LjUgNC41djEuNWEuNzUuNzUgMCAwIDAgLjcuNzVIMjEuNzVjLjQxNCAwIC43NS0uMzM2Ljc1LS43NXYtMS41Yy4wMS0xLjQyLS4wNC0yLjczLS4wOS00YTEgMSAwIDAgMC0xLS43NWgtMTNhLjc1Ljc1IDAgMCAwLS43NS43NXYxLjVhLjc1Ljc1IDAgMCAwIC43NS43NWg1VjguNTVhLjc1Ljc1IDAgMCAwLS43NS0uNzVoLTEuMjVhLjc1Ljc1IDAgMCAwLS43NS43NXY1Yy4wMS40MTQuMzM2Ljc1Ljc1Ljc1aDEuMjVhLjc1Ljc1IDAgMCAwIC43NS0uNzVWMjEuNTVjLjA1LS42My4xLTEuMjkuMS0yLjAyYTEuNSAxLjUgMCAwIDAtMS41LTEuNWgtdjEuMjVjMCAuNDE0LS4zMzYuNzUtLjc1Ljc1aC0xLjVhLjc1Ljc1IDAgMCAwLS43NS43NVYyMS43NWMwIC40MTQuMzM2Ljc1Ljc1Ljc1SDE5LjI1Yy40MTQgMCAuNzUtLjMzNi43NS0uNzVWMjEuNzVjLjAxLS40MTQtLjMzNi0uNzUtLjc1LS43NWgtMS41YTEuNSAxLjUgMCAwIDAtMS41IDEuNXYyLjQ4YTEuNSAxLjUgMCAwIDAtMS41IDEuNVYxOC41Yy4wNS0uNjMuMS0xLjI5LjEtMi4wMmEyIDIgMCAwIDAtMi0yaC0xMC41Yy0xLjM2IDAtMi41LjcyLTIuNSAyLjA4di01LjU0YzAtMS4zNyAxLjE0LTIuMDggMi41LTIuMDhoMTAuNWMuNDEzIDAgLjc1LS4zMzYuNzUtLjc1di0xLjVjLjAxLS40MTQtLjMzNi0uNzUtLjc1LS43NUg3VjEyLjI1Yy0uMDUtLjYzLS4xLTEuMjktLjEtMi4wMmEyIDIgMCAwIDAgMi0yVjUuNTZjMC0xLjM3LTEuMTQtMi4wOC0yLjUtMi4wOEgyLjI1Yy0xLjM2IDAtMi41Ljc3LTIuNSA1LjA1djEuNzVhMi41IDIuNSAwIDAgMCAyLjUgMi41TDIxLjc1YzEuMzYgMCAyLjU0LS42NyAyLjU0LTUuMDVWMi4yNWEyLjUgMi41IDAgMCAwLTIuNS0yLjVoLTE5Yy0xLjM2IDAtMi41Ljc3LTIuNSAzLjAzdjEuNzVhMi41IDIuNSAwIDAgMCAyLjUgMi41Ii8+PC9zdmc+'" class="tab-favicon w-5 h-5 object-contain flex-shrink-0">
    //         <span class="tab-title text-sm truncate">${tab.title}</span>
    //     `;
    //     li.addEventListener('click', () => handleTabClick(tab, li));
    //     return li;
    // }

    function createTabElement(tab) {
        const li = document.createElement('li');
        li.className =
            'tab-item flex items-center gap-3 p-2 rounded-lg text-sm text-gray-700 cursor-pointer transition-colors duration-150 hover:bg-blue-50';
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
            // Fallback favicon for invalid URLs
            faviconUrl =
                "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHRleHQgeT0iLjllbSIgZm9udC1zaXplPSI5MCI+🔖</dGV4dD48L3N2Zz4=";
            }
        }

        li.innerHTML = `
            <img src="${faviconUrl}" 
                class="tab-favicon w-5 h-5 object-contain flex-shrink-0 rounded-sm"
                onerror="this.onerror=null;this.src='data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHRleHQgeT0iLjllbSIgZm9udC1zaXplPSI5MCI+🔖</dGV4dD48L3N2Zz4='">
            <span class="tab-title text-sm truncate">${tab.title || 'Untitled Tab'}</span>
        `;

        li.addEventListener('click', () => handleTabClick(tab, li));

        return li;
    }


    function handleTabClick(tab, tabElement) {
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

    // Function to update the highlighted tab in the sidepanel
    function updateHighlightedTab(tabId, url, title) {
        const allTabs = document.querySelectorAll('.tab-item');
        allTabs.forEach(tab => {
            const tabTitle = tab.querySelector('.tab-title')?.textContent;
            
            // Highlight based on ID or similar title/URL (in case the ID has changed due to restart/re-open)
            if (tab.dataset.tabId === tabId || (tabTitle === title && tab.dataset.url === url)) {
                highlightActiveTab(tab);
            }
        });
    }

    function highlightActiveTab(activeTabElement) {
        // Remove highlight from previously active tab
        const previouslyActive = document.querySelector('.tab-item.active');
        if (previouslyActive) {
            previouslyActive.classList.remove('active', 'bg-blue-100', 'font-semibold');
        }

        // Add highlight to the new active tab
        if (activeTabElement) {
            activeTabElement.classList.add('active', 'bg-blue-100', 'font-semibold');
            
            // Ensure the highlighted tab is visible by scrolling to it
            // Scroll to the group/subgroup header first if collapsed
            let parentContainer = activeTabElement.closest('.tab-group-cont.hidden, .tab-subgroup-cont.hidden');
            if (parentContainer) {
                // If it's a hidden subgroup, click its header to expand
                let subgroupHeader = parentContainer.previousElementSibling;
                if (subgroupHeader && subgroupHeader.classList.contains('tab-subgroup-header')) {
                    subgroupHeader.click();
                }
                
                // If it's a hidden group, click its header to expand
                let groupHeader = activeTabElement.closest('.tab-group-item')?.querySelector('.tab-group-header');
                if (groupHeader && activeTabElement.closest('.tab-group-cont.hidden')) {
                     groupHeader.click();
                }
            }
            
            activeTabElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    }

    // Function to save the current tab order (Placeholder - the logic relies on IDs which are temporary)
    function saveTabOrder() {
        // NOTE: Saving drag-and-drop state is complex because closed tab IDs are temporary (they change when re-opened).
        // For a full implementation, you'd need to save the Group/Subgroup structure and associate tabs by URL/Title.
        console.log('Tab order manipulation detected. Current manual save logic is a placeholder.');
    }

    function generateId() {
        return 'id_' + Math.random().toString(36).substr(2, 9);
    }

    // Initial load of stored tabs
    updateTabList();

    // Add these new functions at the end of your file
    function closeAllDropdowns() {
        document.querySelectorAll('.group-dropdown, .subgroup-dropdown').forEach(dropdown => {
            dropdown.classList.add('hidden');
        });
    }

    function handleGroupAction(action, group) {
        switch(action) {
            case 'open':
                // Collect all tabs from all subgroups
                const allGroupTabs = group.subgroups.reduce((acc, subgroup) => {
                    return acc.concat(subgroup.tabs);
                }, []);
                
                chrome.runtime.sendMessage({
                    action: "openInGroup",
                    groupData: {
                        title: group.title,
                        tabs: allGroupTabs
                    }
                }, (response) => {
                    if (response.status === "error") {
                        console.error('Error opening group:', response.message);
                    }
                });
                break;

            case 'delete':
                console.log('Deleting group:', group.title);
                chrome.runtime.sendMessage({
                    action: "deleteGroup",
                    groupId: group.id
                });
                break;

            case 'summarize':
                console.log('Summarizing group:', group.title);
                chrome.runtime.sendMessage({
                    action: "summarizeGroup",
                    groupId: group.id
                });
                break;
        }
        closeAllDropdowns();
    }

    function handleSubgroupAction(action, subgroup) {
        switch(action) {
            case 'open':
                chrome.runtime.sendMessage({
                    action: "openInGroup",
                    groupData: {
                        title: subgroup.title,
                        tabs: subgroup.tabs
                    }
                }, (response) => {
                    if (response.status === "error") {
                        console.error('Error opening subgroup:', response.message);
                    }
                });
                break;

            case 'delete':
                console.log('Deleting subgroup:', subgroup.title);
                chrome.runtime.sendMessage({
                    action: "deleteSubgroup",
                    subgroupId: subgroup.id
                });
                break;

            case 'summarize':
                console.log('Summarizing subgroup:', subgroup.title);
                chrome.runtime.sendMessage({
                    action: "summarizeSubgroup",
                    subgroupId: subgroup.id
                });
                break;
        }
        closeAllDropdowns();
    }



     // Tab switching functionality
    const tabButtons = document.querySelectorAll('#bottom-navbar button');
    const tabSections = document.querySelectorAll('.tab-section');
    
    function switchTab(tabId) {
        // Hide all sections
        tabSections.forEach(section => section.classList.add('hidden'));
        
        // Remove active state from all buttons
        tabButtons.forEach(btn => {
            const icon = btn.querySelector('svg');
            const text = btn.querySelector('span');
            icon.classList.remove('text-blue-600');
            icon.classList.add('text-gray-500');
            text.classList.remove('text-blue-600');
        });
        
        // Show selected section
        const selectedSection = document.getElementById(`${tabId}-section`);
        if (selectedSection) {
            selectedSection.classList.remove('hidden');
        }
        
        // Update active button state
        const activeButton = Array.from(tabButtons).find(btn => 
            btn.querySelector('span').textContent.toLowerCase() === tabId.replace('-view', '')
        );
        if (activeButton) {
            const icon = activeButton.querySelector('svg');
            const text = activeButton.querySelector('span');
            icon.classList.remove('text-gray-500');
            icon.classList.add('text-blue-600');
            text.classList.add('text-blue-600');
        }
    }
    
    // Add click handlers to bottom navbar buttons
    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            const tabName = button.querySelector('span').textContent.toLowerCase().replace(' ', '-');
            switchTab(tabName === 'tab-view' ? 'tab-view' : tabName);
        });
    });

    // Initialize with tab-view selected
    switchTab('tab-view');

    // Handle settings toggles
    const darkModeToggle = document.getElementById('darkModeToggle');
    const autoOrganizeToggle = document.getElementById('autoOrganizeToggle');

    if (darkModeToggle) {
        darkModeToggle.addEventListener('change', (e) => {
            const isDarkMode = e.target.checked;
            // Implement dark mode logic here
            chrome.storage.local.set({ darkMode: isDarkMode });
        });
    }

    if (autoOrganizeToggle) {
        autoOrganizeToggle.addEventListener('change', (e) => {
            const isAutoOrganize = e.target.checked;
            // Implement auto-organize logic here
            chrome.storage.local.set({ autoOrganize: isAutoOrganize });
        });
    }

    // Load saved settings
    chrome.storage.local.get(['darkMode', 'autoOrganize'], (result) => {
        if (darkModeToggle) darkModeToggle.checked = result.darkMode || false;
        if (autoOrganizeToggle) autoOrganizeToggle.checked = result.autoOrganize || false;
    });

    // Bookmark management functions
    function fetchAndDisplayBookmarks() {
        chrome.bookmarks.getTree((bookmarkTreeNodes) => {
            const bookmarksList = document.getElementById('bookmarks-list');
            bookmarksList.innerHTML = ''; // Clear existing bookmarks

            // Helper function: Render bookmarks inside a folder
            function renderBookmarks(nodes) {
                return nodes.map(node => {
                    if (node.children) {
                        // Folder inside folder (nested)
                        return `
                            <li class="ml-4">
                                <details class="group">
                                    <summary class="flex items-center gap-2 cursor-pointer p-2 hover:bg-gray-50 rounded-lg">
                                        <svg class="w-4 h-4 text-gray-500 group-open:rotate-90 transition-transform" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                                            <path d="M6 6L14 10L6 14V6Z"/>
                                        </svg>
                                        <span class="font-medium text-sm text-gray-700">${node.title}</span>
                                    </summary>
                                    <ul class="ml-4 mt-1">
                                        ${renderBookmarks(node.children)}
                                    </ul>
                                </details>
                            </li>
                        `;
                    } else {
                        // Single bookmark
                        return `
                            <li>
                                <a href="${node.url}" 
                                class="flex items-center gap-2 p-2 hover:bg-gray-50 rounded-lg text-sm text-gray-600 hover:text-blue-600"
                                target="_blank">
                                    <img 
                                        src="https://www.google.com/s2/favicons?domain=${new URL(node.url).hostname}&sz=32"
                                        class="w-4 h-4 rounded-sm"
                                        onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🔖</text></svg>'"
                                    />
                                    <span class="truncate">${node.title || node.url}</span>
                                </a>
                            </li>
                        `;
                    }
                }).join('');
            }

            // Render top-level folders (Bookmarks Bar, Other Bookmarks, Mobile Bookmarks)
            const rootChildren = bookmarkTreeNodes[0].children || [];
            const html = rootChildren.map(folder => `
                <details class="group border border-gray-200 rounded-xl mb-2">
                    <summary class="flex items-center justify-between p-2 bg-gray-50 hover:bg-gray-100 rounded-lg cursor-pointer">
                        <div class="flex items-center gap-2">
                            <svg class="w-4 h-4 text-gray-500 group-open:rotate-90 transition-transform" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                                <path d="M6 6L14 10L6 14V6Z"/>
                            </svg>
                            <span class="font-medium text-sm text-gray-800">${folder.title}</span>
                        </div>
                    </summary>
                    <ul class="ml-4 mt-2">
                        ${renderBookmarks(folder.children || [])}
                    </ul>
                </details>
            `).join('');

            bookmarksList.innerHTML = html;

            // Add click handlers to open bookmarks in a new tab
            bookmarksList.querySelectorAll('a').forEach(link => {
                link.addEventListener('click', (e) => {
                    e.preventDefault();
                    chrome.tabs.create({ url: link.href });
                });
            });
        });
    }


    // Call fetchAndDisplayBookmarks when switching to the bookmarks tab
    const bottomNavButtons = document.querySelectorAll('#bottom-navbar button');
    bottomNavButtons.forEach(button => {
        button.addEventListener('click', () => {
            const tabName = button.querySelector('span').textContent.toLowerCase();
            if (tabName === 'bookmarks') {
                fetchAndDisplayBookmarks();
            }
        });
    });

    // Initial load of bookmarks if starting on bookmarks tab
    if (window.location.hash === '#bookmarks') {
        fetchAndDisplayBookmarks();
    }

    function createNoteCard(note) {
        const card = document.createElement('div');
        card.className = 'rounded-lg shadow';
        card.dataset.noteId = note.id;
        
        card.innerHTML = `
            <div class="relative bg-white border border-gray-200 rounded-xl shadow-sm hover:shadow-md transition-all p-4">

                <!-- Header: icon + source + date -->
                <div class="flex items-start justify-between gap-2 mb-2">
                    <div class="flex gap-2">
                        <div class="flex-shrink-0 text-blue-500 bg-[#edf2fa] rounded-full p-1">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" 
                                stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
                            </svg>
                        </div>
                        <div class="flex flex-col gap-1">
                            <a href="${note.source}" target="_blank" 
                            class="text-sm font-medium text-gray-700 hover:text-blue-600 truncate max-w-[200px] whitespace-normal break-words " style="text-wrap: auto;">
                            ${note.title}
                            </a>
                            <span class="text-xs text-gray-400">${new Date(note.timestamp).toLocaleDateString()}</span>
                        </div>
                    </div>    
                    <!-- Delete button -->
                    <button class="delete-note text-gray-400 hover:text-red-500 transition-colors bg-[#edf2fa] rounded-rounded p-1" title="Delete note">
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" 
                            stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M3 6h18M9 6V4h6v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14z"/>
                        </svg>
                    </button>
                </div>

                <!-- Note text -->
                <p class="text-sm text-gray-800 leading-relaxed whitespace-pre-line">${note.text}</p>
            </div>
        `;


        // Add delete handler
        card.querySelector('.delete-note').addEventListener('click', () => {
            chrome.storage.local.get(['searchmate_notes'], (result) => {
                const notes = result.searchmate_notes || [];
                const updatedNotes = notes.filter(n => n.id !== note.id);
                chrome.storage.local.set({ searchmate_notes: updatedNotes }, () => {
                    card.remove();
                    updateEmptyNotesMessage();
                });
            });
        });

        return card;
    }

    function updateEmptyNotesMessage() {
        const notesContainer = document.getElementById('notes-container');
        const emptyMessage = document.getElementById('empty-notes-message');
        
        if (notesContainer.children.length === 0) {
            emptyMessage.classList.remove('hidden');
        } else {
            emptyMessage.classList.add('hidden');
        }
    }

    let notesEmptyAnimation = null;

    function loadNotes() {
        const notesContainer = document.getElementById('notes-container');
        
        chrome.storage.local.get(['searchmate_notes'], (result) => {
            const notes = result.searchmate_notes || [];
            notesContainer.innerHTML = '';
            
            if (notes.length === 0) {
                // Show empty state with animation
                const emptyMessage = document.getElementById('empty-notes-message');
                emptyMessage.classList.remove('hidden');
                
                // Only initialize animation if it doesn't exist
                if (!notesEmptyAnimation) {
                    fetch(chrome.runtime.getURL('assets/loader/Empty Box.json'))
                        .then(response => response.json())
                        .then(animationData => {
                            // Destroy existing animation if it exists
                            if (notesEmptyAnimation) {
                                notesEmptyAnimation.destroy();
                            }
                            
                            notesEmptyAnimation = lottie.loadAnimation({
                                container: document.getElementById('empty-notes-animation'),
                                renderer: 'svg',
                                loop: true,
                                autoplay: true,
                                animationData: animationData
                            });
                        })
                        .catch(error => console.error('Error loading empty notes animation:', error));
                }
            } else {
                // Hide empty message and show notes
                document.getElementById('empty-notes-message').classList.add('hidden');
                // Destroy animation if it exists when showing notes
                if (notesEmptyAnimation) {
                    notesEmptyAnimation.destroy();
                    notesEmptyAnimation = null;
                }
                notes.forEach(note => {
                    notesContainer.appendChild(createNoteCard(note));
                });
            }
        });
    }

    // Listen for new notes
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === "noteAdded") {
            const notesContainer = document.getElementById('notes-container');
            notesContainer.insertBefore(createNoteCard(request.note), notesContainer.firstChild);
            updateEmptyNotesMessage();
        }
    });

    // Load notes when switching to notes tab
    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            const tabName = button.querySelector('span').textContent.toLowerCase();
            if (tabName === 'notes') {
                loadNotes();
            } else {
                // Cleanup animation when switching away from notes
                if (notesEmptyAnimation) {
                    notesEmptyAnimation.destroy();
                    notesEmptyAnimation = null;
                }
            }
        });
    });
    
});



