// Enable the side panel
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((error) => console.error(error));

let masterClosedTabs = [];
let unprocessedTabs = [];
let activeTabGroups = new Map();

// --- Supabase Configuration ---
const SUPABASE_PROJECT_URL = "https://kzutjgbhhpivedknfxbx.supabase.co"; // REPLACE THIS
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt6dXRqZ2JoaHBpdmVka25meGJ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM2NTgzNzQsImV4cCI6MjA3OTIzNDM3NH0.DkG87JGbSi7h4OTD8iFWmlc72ESdnrabsN-C1wj83pI"; // REPLACE THIS
const SUPABASE_FUNCTION_URL = `${SUPABASE_PROJECT_URL}/functions/v1/process-tabs`;

const UNPROCESSED_TABS_KEY = 'searchmate_unprocessedTabs';
const GROUPED_TABS_KEY = 'searchmate_groupedTabs';
const MASTER_TABS_KEY = 'cursorIDE_storedTabs';

/**
 * Calls the Supabase Edge Function
 * @param {string} mode - 'FULL_REGROUP' or 'INCREMENTAL'
 * @param {object} payload - The data object to send
 */
async function callSupabaseFunction(mode, payload) {
    try {
        const response = await fetch(SUPABASE_FUNCTION_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
            },
            body: JSON.stringify({ mode, payload })
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Supabase Error ${response.status}: ${errorText}`);
        }

        return await response.json();
    } catch (error) {
        console.error("Edge Function Call Failed:", error);
        throw error;
    }
}

/**
 * Uses Server-Side AI to group tabs (FULL REGROUP MODE).
 */
async function groupTabsWithAI_FullRegroup(tabs) {
    if (!tabs || tabs.length === 0) {
        return { groups: [], ungrouped: [] };
    }
    console.log('AI grouping started (FULL REGROUP) via Server.');

    try {
        // 1. Call Server
        const aiGroupedData = await callSupabaseFunction('FULL_REGROUP', { tabs: tabs });

        // 2. Rehydrate the grouped IDs with full tab data (Client Side Logic)
        const tabMap = new Map(tabs.map(tab => [tab.id.toString(), tab]));

        const finalGroups = aiGroupedData.groups.map(group => ({
            ...group,
            subgroups: group.subgroups.map(subgroup => ({
                ...subgroup,
                tabs: subgroup.tabs.map(tabIdObj => tabMap.get(tabIdObj.id)).filter(tab => tab)
            }))
        }));

        const finalUngrouped = aiGroupedData.ungrouped.map(tabIdObj => tabMap.get(tabIdObj.id)).filter(tab => tab);

        console.log('Server grouping complete.');
        return { groups: finalGroups, ungrouped: finalUngrouped };
    } catch (error) {
        console.error('Error grouping tabs via Server:', error);
        // Fallback: return all tabs as ungrouped
        return { groups: [], ungrouped: tabs };
    }
}

/**
 * Uses Server-Side AI to generate actions for Incremental Grouping.
 */
async function incrementalGroupTabs() {
    console.log('AI grouping started (INCREMENTAL) via Server.');
    const storage = await chrome.storage.local.get([GROUPED_TABS_KEY, UNPROCESSED_TABS_KEY]);
    let existingGroupedTabs = storage[GROUPED_TABS_KEY] || { groups: [], ungrouped: [] };
    const newTabs = storage[UNPROCESSED_TABS_KEY] || [];

    if (newTabs.length === 0) return existingGroupedTabs;

    let aiActions = [];

    try {
        // 1. Call Server to get Actions
        const response = await callSupabaseFunction('INCREMENTAL', {
            newTabs: newTabs,
            existingGroups: existingGroupedTabs // Sending full structure, server can compress if needed, or we compress here to save bandwidth
        });
        
        aiActions = response.actions;
        if (!Array.isArray(aiActions)) throw new Error("Invalid actions received from server");

    } catch (error) {
        console.error('Error getting incremental actions from server:', error);
        // Fallback: put all new tabs in ungrouped list
        existingGroupedTabs.ungrouped.push(...newTabs);
        await chrome.storage.local.set({ [GROUPED_TABS_KEY]: existingGroupedTabs, [UNPROCESSED_TABS_KEY]: [] });
        return existingGroupedTabs;
    }

    // 2. Execute Actions (Client Side - Logic remains here to keep storage sync simple)
    let updatedGroupedTabs = JSON.parse(JSON.stringify(existingGroupedTabs));
    const newTabsMap = new Map(newTabs.map(tab => [tab.id.toString(), tab]));
    const existingIds = new Set();

    // Deduplication set population
    updatedGroupedTabs.groups.forEach(group => {
        group.subgroups.forEach(subgroup => {
            subgroup.tabs.forEach(tab => existingIds.add(tab.id.toString()));
        });
    });
    updatedGroupedTabs.ungrouped.forEach(tab => existingIds.add(tab.id.toString()));

    for (const action of aiActions) {
        const tabId = action.tabId;
        const tabData = newTabsMap.get(tabId);
        if (!tabData) continue;

        if (existingIds.has(tabId)) {
            console.warn(`Skipping action for duplicate tab ID: ${tabId}`);
            continue;
        }
        existingIds.add(tabId);

        const newTab = { ...tabData, id: tabData.id.toString() };

        try {
            switch (action.type) {
                case "APPEND_SUBGROUP":
                    {
                        const group = updatedGroupedTabs.groups.find(g => g.title === action.targetGroupTitle);
                        if (group) {
                            const subgroup = group.subgroups.find(sg => sg.title === action.targetSubgroupTitle);
                            if (subgroup) {
                                subgroup.tabs.push(newTab);
                            } else {
                                group.subgroups.push({ title: action.targetSubgroupTitle, tabs: [newTab] });
                            }
                        } else {
                            updatedGroupedTabs.groups.push({
                                title: action.targetGroupTitle,
                                subgroups: [{ title: action.targetSubgroupTitle, tabs: [newTab] }]
                            });
                        }
                        break;
                    }
                case "INSERT_SUBGROUP":
                    {
                        const group = updatedGroupedTabs.groups.find(g => g.title === action.targetGroupTitle);
                        if (group) {
                            group.subgroups.push({ title: action.newSubgroupTitle, tabs: [newTab] });
                        } else {
                            updatedGroupedTabs.groups.push({
                                title: action.targetGroupTitle,
                                subgroups: [{ title: action.newSubgroupTitle, tabs: [newTab] }]
                            });
                        }
                        break;
                    }
                case "INSERT_GROUP":
                    {
                        updatedGroupedTabs.groups.push({
                            title: action.newGroupTitle,
                            subgroups: [{ title: action.newSubgroupTitle, tabs: [newTab] }]
                        });
                        break;
                    }
                case "UNGROUPED":
                    {
                        updatedGroupedTabs.ungrouped.push(newTab);
                        break;
                    }
                default:
                    updatedGroupedTabs.ungrouped.push(newTab);
            }
        } catch (e) {
            console.error(`Error executing action for tab ${tabId}:`, e);
            updatedGroupedTabs.ungrouped.push(newTab);
        }
    }

    await chrome.storage.local.set({ [GROUPED_TABS_KEY]: updatedGroupedTabs, [UNPROCESSED_TABS_KEY]: [] });
    console.log('Server-assisted incremental grouping completed.');
    return updatedGroupedTabs;
}


// --- Standard Extension Logic (Mostly Unchanged) ---

function loadStoredTabs() {
    chrome.storage.local.get([MASTER_TABS_KEY, UNPROCESSED_TABS_KEY], (result) => {
        try {
            const storedTabs = result[MASTER_TABS_KEY] || [];
            masterClosedTabs = storedTabs.slice(0, 100);
            unprocessedTabs = result[UNPROCESSED_TABS_KEY] || [];
        } catch (error) {
            console.error('Error loading stored tabs:', error);
            masterClosedTabs = [];
            unprocessedTabs = [];
        }
    });
}

function saveStoredTabs() {
    return new Promise((resolve, reject) => {
        chrome.storage.local.set({ [MASTER_TABS_KEY]: masterClosedTabs, [UNPROCESSED_TABS_KEY]: unprocessedTabs }, () => {
            if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
            else resolve();
        });
    });
}

async function backupCurrentGrouping() {
    try {
        const result = await chrome.storage.local.get(['searchmate_groupedTabs']);
        if (result.searchmate_groupedTabs) {
            const backup = { data: result.searchmate_groupedTabs, timestamp: Date.now(), version: '1.0' };
            await chrome.storage.local.set({ backup_groupedTabs: backup });
            return true;
        }
        return false;
    } catch (error) {
        console.error('Error creating backup:', error);
        return false;
    }
}

async function restoreGroupingFromBackup() {
    try {
        const result = await chrome.storage.local.get(['backup_groupedTabs']);
        if (result.backup_groupedTabs?.data) {
            await chrome.storage.local.set({ searchmate_groupedTabs: result.backup_groupedTabs.data });
            return { status: "success", message: "Restored", timestamp: result.backup_groupedTabs.timestamp };
        }
        return { status: "error", message: "No backup found" };
    } catch (error) {
        return { status: "error", message: error.message };
    }
}

// --- Event Listeners ---

chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({ id: "add-to-notes", title: "Add to SearchMate notes", contexts: ["selection"] });
    chrome.contextMenus.create({ id: "insert-notes", title: "Clip to notes", contexts: ["selection"] });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === "add-to-notes") {
        const noteData = { text: info.selectionText, source: tab.url, title: tab.title, timestamp: new Date().toISOString(), id: 'note_' + Date.now() };
        chrome.storage.local.get(['searchmate_notes'], (result) => {
            const notes = result.searchmate_notes || [];
            notes.unshift(noteData);
            chrome.storage.local.set({ searchmate_notes: notes }, () => {
                chrome.runtime.sendMessage({ action: "noteAdded", note: noteData });
            });
        });
    } else if (info.menuItemId === "insert-notes") {
        chrome.runtime.sendMessage({ action: "insertToEditor", text: info.selectionText, source: tab.url, title: tab.title });
    }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    switch (request.action) {
        case "organizeTabs":
            (async () => {
                await organizeTabs();
                sendResponse({ status: "success" });
            })();
            return true;
        case "getClosedTabs":
            (async () => {
                const result = await chrome.storage.local.get(['existingGroup', GROUPED_TABS_KEY, UNPROCESSED_TABS_KEY, MASTER_TABS_KEY]);
                const useIncrementalGrouping = result.existingGroup === true || result.existingGroup === undefined;
                const masterTabs = result[MASTER_TABS_KEY] || [];
                let groupedTabs;

                if (!useIncrementalGrouping) {
                    if (request.forceRegroup || !result[GROUPED_TABS_KEY]) {
                        await backupCurrentGrouping();
                        await chrome.storage.local.remove(UNPROCESSED_TABS_KEY);
                        groupedTabs = await groupTabsWithAI_FullRegroup(masterTabs);
                        await chrome.storage.local.set({ [GROUPED_TABS_KEY]: groupedTabs });
                    } else {
                        groupedTabs = result[GROUPED_TABS_KEY];
                    }
                } else if (request.forceRefresh) {
                    groupedTabs = result[GROUPED_TABS_KEY];
                } else if (useIncrementalGrouping && (result[UNPROCESSED_TABS_KEY]?.length > 0 || !result[GROUPED_TABS_KEY])) {
                    groupedTabs = await incrementalGroupTabs();
                } else {
                    groupedTabs = result[GROUPED_TABS_KEY];
                }
                sendResponse({ groupedTabs: groupedTabs });
            })();
            return true;
        case "removeFromClosedTabs":
            masterClosedTabs = masterClosedTabs.filter(tab => tab.id !== request.tabId);
            unprocessedTabs = unprocessedTabs.filter(tab => tab.id !== request.tabId);
            saveStoredTabs();
            sendResponse({ status: "success" });
            break;
        case "openAndRemoveTab":
            chrome.tabs.create({ url: request.url }, () => {
                masterClosedTabs = masterClosedTabs.filter(tab => tab.id !== request.tabId);
                unprocessedTabs = unprocessedTabs.filter(tab => tab.id !== request.tabId);
                saveStoredTabs();
                sendResponse({ status: "success" });
            });
            return true;
        case "clearAllStoredTabs":
            masterClosedTabs = [];
            unprocessedTabs = [];
            chrome.storage.local.remove([GROUPED_TABS_KEY, UNPROCESSED_TABS_KEY]);
            saveStoredTabs();
            sendResponse({ status: "success" });
            break;
        case "toggleSidebar":
            toggleSidebarForAllTabs();
            return true;
        case "openTab":
            chrome.tabs.create({ url: request.url }, () => { sendResponse({ status: "success" }); });
            return true;
        case "openInGroup":
            if (request.groupData) {
                openTabsInGroup(request.groupData.tabs, request.groupData.title).then(sendResponse);
                return true;
            }
            break;
        case "restoreGrouping":
            restoreGroupingFromBackup().then(sendResponse);
            return true;
        case "checkBackupExists":
            chrome.storage.local.get(['backup_groupedTabs'], (result) => { sendResponse({ exists: !!result.backup_groupedTabs }); });
            return true;
    }
    return true;
});

function toggleSidebarForAllTabs() {
    chrome.storage.local.get(['sidebarVisible'], (result) => {
        const newState = !result.sidebarVisible;
        chrome.storage.local.set({ sidebarVisible: newState }, () => {
            chrome.tabs.query({}, (tabs) => {
                tabs.forEach(tab => {
                    if (!isRestrictedUrl(tab.url)) {
                        chrome.tabs.sendMessage(tab.id, { action: "updateSidebar", visible: newState });
                    }
                });
            });
        });
    });
}

async function organizeTabs() {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const activeTab = tabs.find(tab => tab.active);
    const tabsToRemove = [];
    await backupCurrentGrouping();
    const newClosedTabs = [];

    tabs.forEach(tab => {
        if (tab.id !== activeTab.id && !isRestrictedUrl(tab.url)) {
            const tabData = { id: tab.id.toString(), title: tab.title, url: tab.url, favicon: tab.favIconUrl, closedTimestamp: Date.now() };
            masterClosedTabs.unshift(tabData);
            newClosedTabs.push(tabData);
            tabsToRemove.push(tab.id);
        }
    });

    unprocessedTabs.unshift(...newClosedTabs);
    masterClosedTabs = masterClosedTabs.slice(0, 100);
    if (tabsToRemove.length > 0) await chrome.tabs.remove(tabsToRemove);
    await saveStoredTabs();
}

function isRestrictedUrl(url) {
    return url.startsWith('chrome://') || url.startsWith('https://chrome.google.com/webstore') || url.startsWith('chrome-extension://') || url.startsWith('chrome://extensions');
}

chrome.runtime.onInstalled.addListener(() => { loadStoredTabs(); });
loadStoredTabs();

chrome.tabs.onActivated.addListener((activeInfo) => {
    chrome.tabs.get(activeInfo.tabId, (tab) => {
        if (tab && !isRestrictedUrl(tab.url)) updateActiveTabInSidepanel(tab);
    });
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && tab.active && !isRestrictedUrl(tab.url)) updateActiveTabInSidepanel(tab);
    if (changeInfo.status === 'complete' && tab.groupId !== -1 && !isRestrictedUrl(tab.url)) await updateStorageWithFinalTabInfo(tab);
});

function updateActiveTabInSidepanel(tab) {
    chrome.runtime.sendMessage({ action: "updateActiveTab", tabId: tab.id.toString(), url: tab.url, title: tab.title });
}

async function openTabsInGroup(tabs, groupTitle) {
    try {
        const createdTabs = await Promise.all(tabs.map(tab => chrome.tabs.create({ url: tab.url, active: false })));
        const tabIds = createdTabs.map(tab => tab.id);
        const groupId = await chrome.tabs.group({ tabIds });
        await chrome.tabGroups.update(groupId, { title: groupTitle, collapsed: false });
        await linkLiveGroupToStorage(groupTitle, groupId);
        activeTabGroups.set(groupId, { title: groupTitle, tabs: createdTabs.map(tab => ({ id: tab.id.toString(), title: tab.title || "New Tab", url: tab.url, favicon: tab.favIconUrl })) });
        return { status: "success", groupId: groupId, tabs: createdTabs };
    } catch (error) {
        return { status: "error", message: error.message };
    }
}

chrome.tabs.onCreated.addListener(async (tab) => {
    try {
        const fullTab = await chrome.tabs.get(tab.id);
        const groupId = fullTab.groupId;
        if (groupId === -1 || isRestrictedUrl(fullTab.url)) return;
        const group = await chrome.tabGroups.get(groupId);
        if (!activeTabGroups.has(groupId)) activeTabGroups.set(groupId, { title: group.title, tabs: [] });
        const groupData = activeTabGroups.get(groupId);
        groupData.tabs.push({ id: fullTab.id.toString(), title: fullTab.title || "Loading...", url: fullTab.url || "", favicon: fullTab.favIconUrl });
        await updateStorageWithNewTabPlaceholder(groupId, fullTab);
    } catch (error) {
        console.warn('Error handling new tab creation event:', error.message);
    }
});

async function updateStorageWithNewTabPlaceholder(groupId, tab) {
    try {
        const result = await chrome.storage.local.get(['searchmate_groupedTabs']);
        let groupedTabs = result.searchmate_groupedTabs || { groups: [], ungrouped: [] };
        const group = groupedTabs.groups.find(g => g.liveChromeGroupId === groupId);
        if (group) {
            if (!group.subgroups || group.subgroups.length === 0) group.subgroups = [{ title: "Grouped Tabs", tabs: [] }];
            if (!group.subgroups[0].tabs) group.subgroups[0].tabs = [];
            group.subgroups[0].tabs.push({ id: tab.id.toString(), title: tab.title || "Loading...", url: tab.url || "", favicon: tab.favIconUrl || "" });
            await chrome.storage.local.set({ searchmate_groupedTabs: groupedTabs });
            chrome.runtime.sendMessage({ action: "tabGroupUpdated", groupedTabs: groupedTabs });
        }
    } catch (error) { console.error('Error adding new tab placeholder:', error); }
}

async function updateStorageWithFinalTabInfo(tab) {
    try {
        const result = await chrome.storage.local.get(['searchmate_groupedTabs']);
        let groupedTabs = result.searchmate_groupedTabs || { groups: [], ungrouped: [] };
        let updated = false;
        for (const group of groupedTabs.groups) {
            for (const subgroup of group.subgroups) {
                const index = subgroup.tabs.findIndex(t => t.id === tab.id.toString());
                if (index !== -1) {
                    subgroup.tabs[index] = { id: tab.id.toString(), title: tab.title, url: tab.url, favicon: tab.favIconUrl || "", closedTimestamp: subgroup.tabs[index].closedTimestamp };
                    updated = true; break;
                }
            }
            if (updated) break;
        }
        if (updated) {
            await chrome.storage.local.set({ searchmate_groupedTabs: groupedTabs });
            chrome.runtime.sendMessage({ action: "tabGroupUpdated", groupedTabs: groupedTabs });
        }
    } catch (error) { console.error('Error updating storage with final tab info:', error); }
}

chrome.tabGroups.onUpdated.addListener((group) => {
    if (activeTabGroups.has(group.id)) activeTabGroups.get(group.id).title = group.title;
});

chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
    activeTabGroups.forEach((groupData, groupId) => {
        groupData.tabs = groupData.tabs.filter(tab => tab.id !== tabId.toString());
        if (groupData.tabs.length === 0) activeTabGroups.delete(groupId);
    });
});

async function linkLiveGroupToStorage(targetTitle, chromeGroupId) {
    try {
        const result = await chrome.storage.local.get(['searchmate_groupedTabs']);
        const groupedTabs = result.searchmate_groupedTabs || { groups: [], ungrouped: [] };
        let parentGroupToLink = groupedTabs.groups.find(g => g.title === targetTitle);
        if (!parentGroupToLink) {
            for (const group of groupedTabs.groups) {
                const isSubgroup = group.subgroups.some(sg => sg.title === targetTitle);
                if (isSubgroup) { parentGroupToLink = group; await chrome.tabGroups.update(chromeGroupId, { title: parentGroupToLink.title }); break; }
            }
        }
        if (parentGroupToLink) {
            parentGroupToLink.liveChromeGroupId = chromeGroupId;
            await chrome.storage.local.set({ searchmate_groupedTabs: groupedTabs });
        }
    } catch (error) { console.error('Error linking live group to storage:', error); }
}