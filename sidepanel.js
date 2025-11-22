import * as TabManager from './sidepanel/tabManager.js';
import * as GroupManager from './sidepanel/groupManager.js';
import * as NoteManager from './sidepanel/noteManager.js';
import * as initializeFolderManagement from './sidepanel/folderManager.js';
import * as FavoriteManager from './sidepanel/favoriteNoteManager.js';
import * as BookmarkManager from './sidepanel/bookmarkManager.js';
import * as SettingsManager from './settings.js';

// --- NEW CREDIT UPDATER FUNCTIONS ---

/**
 * Updates the credit count displayed in the side panel UI.
 * Assumes an element with the ID 'organize_credit_count' exists in the main sidepanel HTML.
 * @param {number|string} credits The current credit count.
 */
function updateCreditDisplay(credits) {
    const creditDisplay = document.getElementById('organize_credit_count');
    if (creditDisplay) {
        // Display 'N/A' or 0 if credits is null/undefined, otherwise show the count
        const displayValue = credits !== undefined && credits !== null ? credits : 'N/A';
        creditDisplay.textContent = `${displayValue}`;
        console.log(`Credit display updated to: ${displayValue}`);
    } else {
        console.warn("Credit display element (#organize_credit_count) not found in the DOM.");
    }
}

/**
 * Fetches the current credit count from storage and requests the latest count from the background script.
 */
async function fetchAndDisplayCredits() {
    // 1. Fetch current stored value for immediate display
    chrome.storage.sync.get(['userCredits'], (result) => {
        const credits = result.userCredits;
        console.log('fetched credit value:', credits);
        updateCreditDisplay(credits);
    });

    // 2. Request the latest credit count from the background script
    try {
        await chrome.runtime.sendMessage({ action: "requestLatestCredits" });
    } catch (error) {
        // This usually happens if the extension is reloaded or the background script is unresponsive
        console.warn("Could not send message to background script for latest credits:", error);
    }
}

// --- END NEW CREDIT UPDATER FUNCTIONS ---


document.addEventListener('DOMContentLoaded', () => {
    //const organizeBtn = document.getElementById('organize');
    //const searchInput = document.getElementById('default-search');
    //const tabGroupList = document.getElementById('tab-group-list');
    const loadingMessage = document.getElementById('loading-message'); // Add a loading message element in your HTML

    // Ensure we have a place to display messages
    if (!loadingMessage) {
        console.error("Missing #loading-message element in HTML.");
    }

    // Tab switching functionality
    const tabButtons = document.querySelectorAll('#bottom-navbar button');
    const tabSections = document.querySelectorAll('.tab-section');
    const tabSectionFiles = {
        'tab-view': 'tabView.html',
        'notes': 'notes.html',
        'bookmarks': 'bookmarks.html',
        'settings': 'settings.html'
    };

    async function switchTab(tabId) {
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
        console.log(`Switching to tab: ${tabId}`);

        // Show selected section and load its HTML
        const selectedSection = document.getElementById(`${tabId}-section`);
        if (selectedSection) {
            selectedSection.classList.remove('hidden');
            await loadTabSection(`${tabId}-section`, tabSectionFiles[tabId]);
        }

        // Update active button state
        const activeButton = Array.from(tabButtons).find(btn => btn.querySelector('span').textContent.toLowerCase() === tabId.replace('-view', ''));
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
    console.log('Initialized sidepanel with tab-view');

    async function loadTabSection(sectionId, componentFile) {
        const container = document.getElementById(sectionId);
        if (!container) return;

        // Only load if not already loaded
        if (!container.dataset.loaded) {
            const response = await fetch(`tabComponents/${componentFile}`);
            const html = await response.text();
            container.innerHTML = html;
            container.dataset.loaded = "true";

            // Re-initialize components based on the loaded section
            switch (sectionId) {
                case 'tab-view-section':
                    // Reinitialize tab view components
                    const organizeBtn = container.querySelector('#organize');
                    const searchInput = container.querySelector('#default-search');
                    if (organizeBtn) organizeBtn.addEventListener('click', organizeTabs);
                    if (searchInput) searchInput.addEventListener('input', searchTabs);
                    // Reload tab list
                    updateTabList();
                    // Initial load of stored tabs AND Credits
                    fetchAndDisplayCredits();
                    break;
                case 'notes-section':
                    // Load Notes
                    loadNotes();
                    // Initialize Folder Management
                    initializeFolderManagement.initializeFolderManagement();
                    // Initialize Favourite Notes
                    FavoriteManager.initializeFavoriteTab();
                    // Initialize Share Notes functionality
                    NoteManager.initializeShareNote();
                    break;
                case 'bookmarks-section':
                    fetchAndDisplayBookmarks();
                    break;
                case 'settings-section':
                    SettingsManager.initializeSettings();
                    break;
            }
        }
    }

    // Add this listener for messages from the background script
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === "updateActiveTab") {
            updateHighlightedTab(request.tabId, request.url, request.title);
        }
        if (request.action === "refreshSidepanel") {
            updateTabList(false, true); // Force refresh without regrouping
        }
        if (request.action === "tabGroupUpdated") {
            console.log('Received tabGroupUpdated message');
            // Update the UI with the new grouped tabs data
            renderGroupedTabs(request.groupedTabs);
        }
        if (request.action === "noteAdded") {
            NoteManager.loadNotes();
        }
        // --- NEW CREDIT UPDATER LOGIC ---
        if (request.action === "creditUpdated" && request.credits !== undefined) {
            updateCreditDisplay(request.credits);
        }
        // --- END NEW CREDIT UPDATER LOGIC ---
    });

    // Listen for changes to chrome.storage
    chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace === 'local' && changes.searchmate_groupedTabs) {
            // Storage was updated, refresh the UI
            updateTabList(false, true);
        }
        // Check for credit changes
        if (namespace === 'local' && changes.userCredits) {
            // Credit storage was updated, update the display
            updateCreditDisplay(changes.userCredits.newValue);
        }
    });

    function organizeTabs() {
        // First ensure we're on the tab view
        switchTab('tab-view').then(() => {
            // Wait a moment for the DOM to update
            setTimeout(() => {
                chrome.runtime.sendMessage({
                    action: "organizeTabs"
                }, () => {
                    // Force regroup after organizing
                    updateTabList(true);
                });
            }, 100);
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
        fetch(chrome.runtime.getURL('assets/loader/Ai Logo.json')).then(response => response.json()).then(animationData => {
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
        // Wait for tab-view section to be ready
        const tabViewSection = document.getElementById('tab-view-section');
        if (!tabViewSection) {
            console.error('Tab view section not found');
            return;
        }

        // Wait for the container elements
        const loadingContainer = tabViewSection.querySelector('#loading-container');
        const tabGroupContainer = tabViewSection.querySelector('#tab-group-container');
        const tabGroupList = tabViewSection.querySelector('#tab-group-list');

        // Verify critical elements exist
        if (!tabGroupList || !tabGroupContainer) {
            console.error('Required container elements not found. Reloading tab view...');
            await loadTabSection('tab-view-section', 'tabView.html');
            // Try to get elements again after reload
            const updatedTabGroupList = document.querySelector('#tab-group-list');
            if (!updatedTabGroupList) {
                console.error('Fatal: Unable to find tab group list container');
                return;
            }
        }

        // Show loading animation
        if (loadingContainer) loadingContainer.classList.remove('hidden');
        if (tabGroupContainer) tabGroupContainer.classList.add('hidden');
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
            if (loadingContainer) loadingContainer.classList.add('hidden');
            if (tabGroupContainer) tabGroupContainer.classList.remove('hidden');
            if (animation) animation.stop();

            console.log('Fetched grouped tabs:', response);
            if (response && response.groupedTabs) {
                console.log('Fetched grouped tabs:', response.groupedTabs);
                renderGroupedTabs(response.groupedTabs);
            } else {
                console.error('No groupedTabs found in response:', response);
                // showEmptyState();
            }
        } catch (error) {
            console.error('Error fetching grouped tabs:', error);
            if (loadingContainer) loadingContainer.classList.add('hidden');
            if (tabGroupContainer) tabGroupContainer.classList.remove('hidden');
            if (animation) animation.stop();
            showEmptyState();
        }
    }

    function renderGroupedTabs(groupedTabs) {
        const tabGroupList = document.getElementById('tab-group-list');
        chrome.storage.local.get(['collapsedView'], (result) => {
            const shouldCollapse = result.collapsedView || false;
            tabGroupList.innerHTML = '';

            const hasNoTabs = (!groupedTabs.groups || groupedTabs.groups.length === 0) && (!groupedTabs.ungrouped || groupedTabs.ungrouped.length === 0);
            if (hasNoTabs) {
                showEmptyState();
                return;
            }

            if (Array.isArray(groupedTabs.groups)) {
                groupedTabs.groups.forEach(group => {
                    if (group && group.title && Array.isArray(group.subgroups)) {
                        tabGroupList.appendChild(GroupManager.createGroupElement(group, false, shouldCollapse));
                    }
                });
            }

            if (groupedTabs.ungrouped && groupedTabs.ungrouped.length > 0) {
                const ungroupedGroup = {
                    id: 'ungrouped',
                    title: 'Other Tabs',
                    subgroups: [{
                        title: 'Miscellaneous',
                        tabs: groupedTabs.ungrouped
                    }]
                };
                tabGroupList.appendChild(GroupManager.createGroupElement(ungroupedGroup, true, shouldCollapse));
            }

            initializeSortable();
        });
    }

    function showEmptyState() {
        const tabGroupContainer = document.getElementById('tab-group-container');
        tabGroupContainer.innerHTML = `<div class="flex flex-col items-center justify-center h-[70vh] px-4 mt-32"><div id="empty-box-animation" class="w-40 h-40 mb-4"></div><p class="text-center text-gray-500 text-sm max-w-xs">Looks like your browser's in chaos! Hit 'Organize' and let AI sort it all out while you sit back and chill.</p></div>`;

        // Initialize Lottie animation for empty state
        fetch(chrome.runtime.getURL('assets/loader/EmptyBox.json')).then(response => response.json()).then(animationData => {
            lottie.loadAnimation({
                container: document.getElementById('empty-box-animation'),
                renderer: 'svg',
                loop: true,
                autoplay: true,
                animationData: animationData
            });
        }).catch(error => console.error('Error loading empty state animation:', error));
    }

    function initializeSortable() {
        const tabGroupList = document.getElementById('tab-group-list');
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
                    group: {
                        name: 'shared-tabs',
                        pull: true,
                        put: true
                    },
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
                    group: {
                        name: 'shared-tabs',
                        pull: true,
                        put: true
                    },
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
        style.textContent = `.sortable-ghost{opacity:0.4;background:#e0f2fe!important;/* Light blue ghost */border:1px dashed #38bdf8;border-radius:0.75rem;}.sortable-chosen{background:#bfdbfe;box-shadow:0 4px 6px rgba(0,0,0,0.1);}.sortable-drag{background:#FFFFFF;box-shadow:0 8px 16px rgba(0,0,0,0.2);}.tab-group-item,.tab-subgroup-item,.tab-item{cursor:grab;}.tab-group-item:active,.tab-subgroup-item:active,.tab-item:active{cursor:grabbing;}`;
        document.head.appendChild(style);
    }

    // Function to update the highlighted tab in the side panel
    function updateHighlightedTab(tabId, url, title) {
        const allTabs = document.querySelectorAll('.tab-item');
        allTabs.forEach(tab => {
            const tabTitle = tab.querySelector('.tab-title')?.textContent;
            if (tab.dataset.tabId === tabId || (tabTitle === title && tab.dataset.url === url)) {
                TabManager.highlightActiveTab(tab);
            }
        });
    }

    // Handles settings toggles
    const darkModeToggle = document.getElementById('darkModeToggle');
    const autoOrganizeToggle = document.getElementById('autoOrganizeToggle');

    if (darkModeToggle) {
        darkModeToggle.addEventListener('change', (e) => {
            const isDarkMode = e.target.checked;
            // Implement dark mode logic here
            chrome.storage.local.set({
                darkMode: isDarkMode
            });
        });
    }

    if (autoOrganizeToggle) {
        autoOrganizeToggle.addEventListener('change', (e) => {
            const isAutoOrganize = e.target.checked;
            // Implement auto-organize logic here
            chrome.storage.local.set({
                autoOrganize: isAutoOrganize
            });
        });
    }

    // Load saved settings
    chrome.storage.local.get(['darkMode', 'autoOrganize'], (result) => {
        if (darkModeToggle) darkModeToggle.checked = result.darkMode || false;
        if (autoOrganizeToggle) autoOrganizeToggle.checked = result.autoOrganize || false;
    });

    // Bookmark management functions
    function fetchAndDisplayBookmarks() {
        BookmarkManager.fetchAndDisplayBookmarks();
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

    // Initial load of bookmarks if starting on bookmark tab
    if (window.location.hash === '#bookmarks') {
        fetchAndDisplayBookmarks();
    }

    // Notes management function
    function loadNotes() {
        NoteManager.loadNotes();
    }

    // Load notes when switching to notes tab
    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            const tabName = button.querySelector('span').textContent.toLowerCase();
            if (tabName === 'notes') {
                loadNotes();
            } else {
                // Cleanup animation when switching away from notes
                NoteManager.cleanupNotesAnimation();
            }
        });
    });

    
    updateTabList();
});


