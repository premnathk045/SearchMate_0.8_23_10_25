// Enable the side panel to open when the extension icon is clicked
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error(error));

let masterClosedTabs = [];

// Array to store tabs that have been closed but not yet processed by AI
let unprocessedTabs = []; 

// Track active tab groups
let activeTabGroups = new Map(); // Map<groupId, {title: string, tabs: Tab[]}>

// --- Gemini API Configuration & Utilities ---
const GEMINI_MODEL = "gemini-2.5-flash-preview-09-2025"; 
const API_KEY = "AIzaSyBvlqp-47QuBWp0Zsu2raPOTbmNk3V8iVc"; // CRITICAL FIX: Leave as an empty string. The environment will inject the key.
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${API_KEY}`;
const MAX_RETRIES = 5;
const UNPROCESSED_TABS_KEY = 'searchmate_unprocessedTabs';
const GROUPED_TABS_KEY = 'searchmate_groupedTabs';
const MASTER_TABS_KEY = 'cursorIDE_storedTabs';
const CUSTOM_PROMPT_KEY = 'custom_instruct_prompt';
const CUSTOM_PROMPT_ENABLED_KEY = 'tabcustom_Instruction';

/**
 * Handles fetch request with exponential backoff for resilience.
 * @param {string} url The API endpoint URL.
 * @param {object} options Fetch options (method, headers, body).
 * @returns {Promise<object>} The JSON response from the API.
 */
async function handleFetchWithRetry(url, options) {
  // Pre-fetch custom instructions if available
  const storageResult = await chrome.storage.local.get([CUSTOM_PROMPT_KEY, CUSTOM_PROMPT_ENABLED_KEY]);
  const isCustomEnabled = storageResult[CUSTOM_PROMPT_ENABLED_KEY] || false;
  let systemPromptOverride = '';

  if (isCustomEnabled && storageResult[CUSTOM_PROMPT_KEY]) {
    systemPromptOverride = `\n\n--- USER CUSTOM INSTRUCTION ---
    ${storageResult[CUSTOM_PROMPT_KEY]}
    ------------------------------`;
  }

  const originalBody = JSON.parse(options.body);
  
  // Append the system instruction if it's the full grouping mode, 
  // or if the custom prompt is required for the incremental mode.
  if (originalBody.systemInstruction) {
    originalBody.systemInstruction.parts[0].text += systemPromptOverride;
  } else if (systemPromptOverride) {
    // If the fetch handler is called for an API request that didn't set a system prompt
    // but relies on a custom instruction (e.g., the new incremental mode), inject it here.
    // NOTE: For the incremental mode, the system prompt is generated inside incrementalGroupTabs,
    // so this primarily impacts the 'Full Regroup' existing function.
  }

  options.body = JSON.stringify(originalBody);

  for (let i = 0; i < MAX_RETRIES; i++) {
    try {
      const response = await fetch(url, options);
      if (!response.ok) {
        if (response.status === 429 && i < MAX_RETRIES - 1) {
          throw new Error('Rate limit exceeded. Retrying...');
        }
        const errorBody = await response.text();
        throw new Error(`API Error ${response.status}: ${errorBody}`);
      }
      return await response.json();
    } catch (error) {
      console.warn(`Attempt ${i + 1} failed:`, error.message);
      if (i === MAX_RETRIES - 1) throw error;
      const delay = Math.pow(2, i) * 1000 + Math.random() * 1000;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

/**
 * Uses Gemini to group tabs based on relevancy (FULL REGROUP MODE - EXISTING LOGIC).
 * @param {Array<object>} tabs List of ALL tabs to group.
 * @returns {Promise<object>} Grouped tabs structure compatible with sidepanel.js.
 */
async function groupTabsWithAI_FullRegroup(tabs) {
  // This remains largely the same as the original function
  if (!tabs || tabs.length === 0) {
    console.log('AI grouping skipped: No tabs provided.');
    return { groups: [], ungrouped: [] };
  }

  console.log('AI grouping process started for', tabs.length, 'tabs (FULL REGROUP).');

  // 1. Prepare data for the model
  const tabList = tabs.map(tab => ({
    id: tab.id.toString(),
    title: tab.title,
    url: tab.url
  }));

  const userQuery = `Group the following list of closed browser tabs into relevant categories (Groups) and smaller sub-categories (Subgroups) based on their title and URL. The goal is to maximize relevance and minimize the number of overall groups, keeping groups small and focused. Tabs that do not belong to any logical group should be returned in the 'ungrouped' list. Always return the full tab list in the output structure using only their 'id'.

Tabs to Group:
${JSON.stringify(tabList, null, 2)}`;

  const systemPrompt = "You are an expert AI Tab Manager. Your task is to analyze a list of tabs and return a clean JSON object containing groups, subgroups, and ungrouped tabs. Every tab ID provided in the input MUST be present exactly once in the output structure (either in a subgroup or in the ungrouped list). Titles for Groups and Subgroups should be concise and descriptive. Focus on logical relevance and clustering related items.";

  // 2. Define the expected JSON response schema (same as before)
  const responseSchema = { /* ... (Schema definition as in existing code) ... */
    type: "OBJECT",
    properties: {
      "groups": {
        "type": "ARRAY",
        "items": {
          "type": "OBJECT",
          "properties": {
            "title": { "type": "STRING", "description": "The concise name of the main group (e.g., 'React Development' or 'Trip Planning')." },
            "subgroups": {
              "type": "ARRAY",
              "items": {
                "type": "OBJECT",
                "properties": {
                  "title": { "type": "STRING", "description": "The concise name of the subgroup (e.g., 'Redux State' or 'Flight Booking')." },
                  "tabs": {
                    "type": "ARRAY",
                    "items": {
                      "type": "OBJECT",
                      "properties": {
                        "id": { "type": "STRING", "description": "The unique string ID of the tab from the input list." }
                      },
                      "propertyOrdering": ["id"]
                    }
                  }
                },
                "propertyOrdering": ["title", "tabs"]
              }
            }
          },
          "propertyOrdering": ["title", "subgroups"]
        }
      },
      "ungrouped": {
        "type": "ARRAY",
        "items": {
          "type": "OBJECT",
          "properties": {
            "id": { "type": "STRING", "description": "The unique string ID of a tab that couldn't be logically grouped." }
          },
          "propertyOrdering": ["id"]
        }
      }
    },
    "propertyOrdering": ["groups", "ungrouped"]
  };

  const payload = {
    contents: [{ parts: [{ text: userQuery }] }],
    systemInstruction: { parts: [{ text: systemPrompt }] },
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: responseSchema
    }
  };

  try {
    const apiResponse = await handleFetchWithRetry(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const jsonText = apiResponse.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!jsonText) {
      console.error("AI response did not contain valid JSON text.");
      return { groups: [], ungrouped: tabs }; // Fallback: return all tabs as ungrouped
    }

    const aiGroupedData = JSON.parse(jsonText);

    // 4. Rehydrate the grouped IDs with full tab data
    const tabMap = new Map(tabs.map(tab => [tab.id.toString(), tab]));

    const finalGroups = aiGroupedData.groups.map(group => ({
      ...group,
      subgroups: group.subgroups.map(subgroup => ({
        ...subgroup,
        tabs: subgroup.tabs
          .map(tabIdObj => tabMap.get(tabIdObj.id))
          .filter(tab => tab) // Filter out any IDs the model hallucinated
      }))
    }));

    const finalUngrouped = aiGroupedData.ungrouped
      .map(tabIdObj => tabMap.get(tabIdObj.id))
      .filter(tab => tab);

    console.log('AI grouping process completed (FULL REGROUP).');
    console.log('Final grouped structure:', { groups: finalGroups, ungrouped: finalUngrouped });
    
    return {
      groups: finalGroups,
      ungrouped: finalUngrouped
    };

  } catch (error) {
    console.error('Error grouping tabs with AI (FULL REGROUP):', error);
    // Fallback: if AI fails, return all tabs as ungrouped
    return { groups: [], ungrouped: tabs };
  }
}

/**
 * NEW FUNCTION: Handles the AI-Assisted Contextual Integration (Incremental Grouping).
 * @returns {Promise<object>} The final merged grouped tabs structure.
 */
async function incrementalGroupTabs() {
    console.log('AI grouping process started (INCREMENTAL INTEGRATION).');
    const storage = await chrome.storage.local.get([GROUPED_TABS_KEY, UNPROCESSED_TABS_KEY]);
    
    let existingGroupedTabs = storage[GROUPED_TABS_KEY] || { groups: [], ungrouped: [] };
    const newTabs = storage[UNPROCESSED_TABS_KEY] || [];
    
    if (newTabs.length === 0) {
        console.log('Incremental grouping skipped: No new tabs to process.');
        return existingGroupedTabs;
    }

    // --- Step 1: Data Preparation & Token Minimization ---

    // A. Prepare Compressed Existing Structure Map
    const compressedStructure = existingGroupedTabs.groups.map(group => ({
        title: group.title,
        subgroups: group.subgroups.map(subgroup => ({
            title: subgroup.title,
            existingTabIds: subgroup.tabs.map(tab => tab.id) // Only IDs, no title/url
        }))
    }));
    
    // B. Prepare New Tabs list (full context needed)
    const newTabsContext = newTabs.map(tab => ({
        id: tab.id.toString(),
        title: tab.title,
        url: tab.url
    }));

    // --- Step 2: AI Prompt and Action Generation ---
    
    const userQuery = `Analyze the following NEW TABS and the EXISTING TAB GROUPS structure. Your task is to generate a list of precise, sequential actions to integrate every single New Tab into the existing structure, create new groups/subgroups, or mark it as ungrouped.

IMPORTANT: You MUST generate exactly one action object for every New Tab ID provided. Do NOT change any existing data or include existing tab IDs in your output.

EXISTING TAB GROUPS (Compressed Structure - DO NOT MODIFY):
${JSON.stringify(compressedStructure, null, 2)}

NEW TABS TO PROCESS:
${JSON.stringify(newTabsContext, null, 2)}`;


    const systemPrompt = `You are an expert AI Tab Manager focused on incremental data merging. Return only a clean JSON object containing an 'actions' array. Each action in the array MUST be an object with a 'tabId' (string from NEW TABS) and a 'type'.
    
    Acceptable Action Types:
    1. APPEND_SUBGROUP: Requires 'targetGroupTitle' (string) and 'targetSubgroupTitle' (string). Use only for existing subgroups.
    2. INSERT_SUBGROUP: Requires 'targetGroupTitle' (string) and 'newSubgroupTitle' (string). Use to create a new subgroup within an existing group.
    3. INSERT_GROUP: Requires 'newGroupTitle' (string) and 'newSubgroupTitle' (string). Use to create a brand new main group.
    4. UNGROUPED: Places the tab in the top-level ungrouped list. No extra properties needed.

    Titles must be concise. Prioritize APPEND_SUBGROUP if contextually relevant.`;

    const responseSchema = {
        type: "OBJECT",
        properties: {
            "actions": {
                "type": "ARRAY",
                "items": {
                    "type": "OBJECT",
                    "properties": {
                        "tabId": { "type": "STRING" },
                        "type": { "type": "STRING", "enum": ["APPEND_SUBGROUP", "INSERT_SUBGROUP", "INSERT_GROUP", "UNGROUPED"] },
                        "targetGroupTitle": { "type": "STRING", "description": "Required for APPEND_SUBGROUP and INSERT_SUBGROUP" },
                        "targetSubgroupTitle": { "type": "STRING", "description": "Required for APPEND_SUBGROUP" },
                        "newSubgroupTitle": { "type": "STRING", "description": "Required for INSERT_SUBGROUP and INSERT_GROUP" },
                        "newGroupTitle": { "type": "STRING", "description": "Required for INSERT_GROUP" }
                    },
                    "required": ["tabId", "type"]
                }
            }
        }
    };
    
    const payload = {
        contents: [{ parts: [{ text: userQuery }] }],
        systemInstruction: { parts: [{ text: systemPrompt }] },
        generationConfig: {
            responseMimeType: "application/json",
            responseSchema: responseSchema
        }
    };
    
    let aiActions;
    try {
        const apiResponse = await handleFetchWithRetry(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const jsonText = apiResponse.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!jsonText) throw new Error("AI response did not contain valid JSON text.");
        
        aiActions = JSON.parse(jsonText).actions;
        if (!Array.isArray(aiActions)) throw new Error("AI response was not a valid action array.");

    } catch (error) {
        console.error('Error getting incremental AI actions:', error);
        // Fallback: put all new tabs in ungrouped list
        existingGroupedTabs.ungrouped.push(...newTabs);
        await chrome.storage.local.set({ [GROUPED_TABS_KEY]: existingGroupedTabs, [UNPROCESSED_TABS_KEY]: [] });
        return existingGroupedTabs;
    }
    
    // --- Step 3: Client-Side Action Execution & De-Duplication ---

    // Create a deep copy to apply actions to
    let updatedGroupedTabs = JSON.parse(JSON.stringify(existingGroupedTabs));
    
    // Helper map for quick tab lookup
    const newTabsMap = new Map(newTabs.map(tab => [tab.id.toString(), tab]));
    
    // Set to track all IDs currently in the structure (for de-duplication)
    const existingIds = new Set();
    updatedGroupedTabs.groups.forEach(group => {
        group.subgroups.forEach(subgroup => {
            subgroup.tabs.forEach(tab => existingIds.add(tab.id.toString()));
        });
    });
    updatedGroupedTabs.ungrouped.forEach(tab => existingIds.add(tab.id.toString()));

    for (const action of aiActions) {
        const tabId = action.tabId;
        const tabData = newTabsMap.get(tabId);

        if (!tabData) continue; // Skip if tab not found in new tabs list
        if (existingIds.has(tabId)) {
            console.warn(`Skipping action for duplicate tab ID: ${tabId}`);
            continue;
        }

        existingIds.add(tabId); // Mark as processed

        const newTab = {
            id: tabData.id.toString(),
            title: tabData.title,
            url: tabData.url,
            favicon: tabData.favicon,
            closedTimestamp: tabData.closedTimestamp
        };

        try {
            switch (action.type) {
                case "APPEND_SUBGROUP": {
                    const group = updatedGroupedTabs.groups.find(g => g.title === action.targetGroupTitle);
                    if (group) {
                        const subgroup = group.subgroups.find(sg => sg.title === action.targetSubgroupTitle);
                        if (subgroup) {
                            subgroup.tabs.push(newTab);
                        } else {
                            // Fallback: create new subgroup if AI suggested append but subgroup doesn't exist
                            group.subgroups.push({ title: action.targetSubgroupTitle, tabs: [newTab] });
                        }
                    } else {
                        // Fallback: create new group if AI suggested append but group doesn't exist
                        updatedGroupedTabs.groups.push({
                            title: action.targetGroupTitle,
                            subgroups: [{ title: action.targetSubgroupTitle, tabs: [newTab] }]
                        });
                    }
                    break;
                }
                case "INSERT_SUBGROUP": {
                    const group = updatedGroupedTabs.groups.find(g => g.title === action.targetGroupTitle);
                    if (group) {
                        group.subgroups.push({ title: action.newSubgroupTitle, tabs: [newTab] });
                    } else {
                        // Fallback: create new group/subgroup if target group doesn't exist
                        updatedGroupedTabs.groups.push({
                            title: action.targetGroupTitle, // Use target title as new group title
                            subgroups: [{ title: action.newSubgroupTitle, tabs: [newTab] }]
                        });
                    }
                    break;
                }
                case "INSERT_GROUP": {
                    updatedGroupedTabs.groups.push({
                        title: action.newGroupTitle,
                        subgroups: [{ title: action.newSubgroupTitle, tabs: [newTab] }]
                    });
                    break;
                }
                case "UNGROUPED": {
                    updatedGroupedTabs.ungrouped.push(newTab);
                    break;
                }
                default:
                    updatedGroupedTabs.ungrouped.push(newTab);
                    console.warn(`Unknown action type '${action.type}' received from AI. Tab ID ${tabId} added to Ungrouped.`);
            }
        } catch (e) {
            console.error(`Error executing action for tab ${tabId}:`, e);
            updatedGroupedTabs.ungrouped.push(newTab); // Safely dump to ungrouped on error
        }
    }

    // Finalize storage: Save the updated grouped tabs and clear the processed list
    await chrome.storage.local.set({ 
        [GROUPED_TABS_KEY]: updatedGroupedTabs, 
        [UNPROCESSED_TABS_KEY]: [] 
    });

    console.log('AI grouping process completed (INCREMENTAL INTEGRATION).');
    return updatedGroupedTabs;
}

// Load previously stored tabs from chrome.storage.local
function loadStoredTabs() {
  chrome.storage.local.get([MASTER_TABS_KEY, UNPROCESSED_TABS_KEY], (result) => {
    try {
      // Load master closed tabs list
      const storedTabs = result[MASTER_TABS_KEY] || [];
      masterClosedTabs = storedTabs.slice(0, 100); 

      // Load tabs waiting for processing
      unprocessedTabs = result[UNPROCESSED_TABS_KEY] || [];

    } catch (error) {
      console.error('Error loading stored tabs:', error);
      masterClosedTabs = [];
      unprocessedTabs = [];
    }
  });
}

// Save closed tabs to chrome.storage.local and return a promise
function saveStoredTabs() {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ 
        [MASTER_TABS_KEY]: masterClosedTabs,
        [UNPROCESSED_TABS_KEY]: unprocessedTabs
    }, () => {
      if (chrome.runtime.lastError) {
        console.error('Error saving closed tabs:', chrome.runtime.lastError);
        reject(chrome.runtime.lastError);
      } else {
        console.log('Successfully saved closed tabs to storage.');
        resolve();
      }
    });
  });
}


// Current group backup helper functions (No change needed here)
async function backupCurrentGrouping() {
  console.log('Backup process started.');
  try {
    const result = await chrome.storage.local.get(['searchmate_groupedTabs']);
    if (result.searchmate_groupedTabs) {
      const backup = {
        data: result.searchmate_groupedTabs,
        timestamp: Date.now(),
        version: '1.0'
      };

      await chrome.storage.local.set({
        backup_groupedTabs: backup
      });

      console.log('Backup created successfully:', backup.timestamp);
      return true;
    }
    return false;
  } catch (error) {
    console.error('Error creating backup:', error);
    return false;
  }
}


// backup group restore function (No change needed here)
async function restoreGroupingFromBackup() {
  try {
    const result = await chrome.storage.local.get(['backup_groupedTabs']);
    if (result.backup_groupedTabs?.data) {
      await chrome.storage.local.set({
        searchmate_groupedTabs: result.backup_groupedTabs.data
      });

      // Verify the restore
      const verify = await chrome.storage.local.get(['searchmate_groupedTabs']);
      if (JSON.stringify(verify.searchmate_groupedTabs) !==
        JSON.stringify(result.backup_groupedTabs.data)) {
        throw new Error('Restore verification failed');
      }

      return {
        status: "success",
        message: "Previous tab grouping restored successfully",
        timestamp: result.backup_groupedTabs.timestamp
      };
    }
    return {
      status: "error",
      message: "No backup found"
    };
  } catch (error) {
    console.error('Error restoring backup:', error);
    return {
      status: "error",
      message: "Failed to restore backup: " + error.message
    };
  }
}


// Create context menu on installation
chrome.runtime.onInstalled.addListener(() => {
  // Context menu for adding notes
  chrome.contextMenus.create({
    id: "add-to-notes",
    title: "Add to SearchMate notes",
    contexts: ["selection"]
  });

  // New context menu for clipping to notes
  chrome.contextMenus.create({
    id: "insert-notes",
    title: "Clip to notes",
    contexts: ["selection"]
  });
});

// Handle context menu clicks for adding notes
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "add-to-notes") {
    const noteData = {
      text: info.selectionText,
      source: tab.url,
      title: tab.title,
      timestamp: new Date().toISOString(),
      id: 'note_' + Date.now()
    };

    // Store the note
    chrome.storage.local.get(['searchmate_notes'], (result) => {
      const notes = result.searchmate_notes || [];
      notes.unshift(noteData); // Add new note at the beginning
      chrome.storage.local.set({ searchmate_notes: notes }, () => {
        // Notify the sidepanel to refresh notes
        chrome.runtime.sendMessage({
          action: "noteAdded",
          note: noteData
        });
      });
    });
  }
  else if (info.menuItemId === "insert-notes") {
    // Send message to sidepanel with the selected text
    chrome.runtime.sendMessage({
      action: "insertToEditor",
      text: info.selectionText,
      source: tab.url,
      title: tab.title
    });
  }
});



// Listen for messages from other parts of the extension
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.action) {

    case "organizeTabs":
      (async () => {
        await organizeTabs();
        sendResponse({ status: "success" });
      })();
      return true; // Important: return true to indicate async response


    case "getClosedTabs":
      // Retrieve stored tabs and group them using AI
      (async () => {
        const result = await chrome.storage.local.get(['existingGroup', GROUPED_TABS_KEY, UNPROCESSED_TABS_KEY, MASTER_TABS_KEY]);
        const useIncrementalGrouping = result.existingGroup === true || result.existingGroup === undefined; // Default to true
        const masterTabs = result[MASTER_TABS_KEY] || [];

        console.log('existingGroup value:', result.existingGroup);
        console.log('useIncrementalGrouping value:', useIncrementalGrouping);
        
        let groupedTabs;

        if (request.forceRegroup || !useIncrementalGrouping) {
            // --- Mode 1: Full Regroup (Existing Architecture) ---
            console.log('backup trigger 02');
            await backupCurrentGrouping();
            
            // Clear existing incremental state
            await chrome.storage.local.remove(UNPROCESSED_TABS_KEY); 
            
            // Use the entire master list
            groupedTabs = await groupTabsWithAI_FullRegroup(masterTabs); 
            
            await chrome.storage.local.set({ [GROUPED_TABS_KEY]: groupedTabs });

        } else if (request.forceRefresh) {
            // --- Mode 3: Force Refresh (No Grouping) ---
            groupedTabs = result[GROUPED_TABS_KEY];

        } else if (useIncrementalGrouping && (result[UNPROCESSED_TABS_KEY]?.length > 0 || !result[GROUPED_TABS_KEY])) {
            // --- Mode 2: Incremental Integration (New Architecture) ---
            console.log('Executing Incremental Grouping.');
            // If this is the very first time, incrementalGroupTabs will see an empty groupedTabs 
            // and treat it as an initial grouping of all current unprocessed tabs.
            groupedTabs = await incrementalGroupTabs(); 

        } else {
            // --- Mode 4: Use Cached Grouping ---
            groupedTabs = result[GROUPED_TABS_KEY];
        }

        sendResponse({ groupedTabs: groupedTabs });
      })();
      return true; // Indicates that the response is sent asynchronously

    // ... existing cases (removeFromClosedTabs, openAndRemoveTab, etc.) ...
    case "removeFromClosedTabs":
      // Remove from master list and unprocessed list
      masterClosedTabs = masterClosedTabs.filter(tab => tab.id !== request.tabId);
      unprocessedTabs = unprocessedTabs.filter(tab => tab.id !== request.tabId);
      saveStoredTabs();
      sendResponse({ status: "success" });
      break;

    case "openAndRemoveTab":
      // Open a closed tab and remove it from the closed tabs list
      chrome.tabs.create({ url: request.url }, () => {
        masterClosedTabs = masterClosedTabs.filter(tab => tab.id !== request.tabId);
        unprocessedTabs = unprocessedTabs.filter(tab => tab.id !== request.tabId);
        saveStoredTabs();
        sendResponse({ status: "success" });
      });
      return true;

    case "clearAllStoredTabs":
      // Clear all stored tabs and unprocessed tabs
      masterClosedTabs = [];
      unprocessedTabs = [];
      chrome.storage.local.remove([GROUPED_TABS_KEY, UNPROCESSED_TABS_KEY]); // Clear associated grouping data
      saveStoredTabs();
      sendResponse({ status: "success" });
      break;

    case "toggleSidebar":
      // Toggle the sidebar visibility for all tabs
      toggleSidebarForAllTabs();
      return true;

    case "openTab":
      // Open the tab without removing it from the closed tabs list
      chrome.tabs.create({ url: request.url }, () => {
        sendResponse({ status: "success" });
      });
      return true;

    case "openInGroup":
      // Handle opening tabs in a Chrome tab group
      if (request.groupData) {
        openTabsInGroup(request.groupData.tabs, request.groupData.title)
          .then(sendResponse);
        return true; // Will respond asynchronously
      }
      break;

    case "restoreGrouping":
      restoreGroupingFromBackup().then(sendResponse);
      return true;

    case "checkBackupExists":
      chrome.storage.local.get(['backup_groupedTabs'], (result) => {
        sendResponse({ exists: !!result.backup_groupedTabs });
      });
      return true;  
  }
  return true;
});

// Toggle sidebar visibility for all tabs
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

// Close all tabs except the current one and store them
async function organizeTabs() {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const activeTab = tabs.find(tab => tab.active);
    const tabsToRemove = [];

    console.log('Tab organization started.');

    console.log('backup trigger 01');
    await backupCurrentGrouping();
    
    // New closed tabs are added to both masterClosedTabs and the unprocessed list
    const newClosedTabs = [];

    tabs.forEach(tab => {
        if (tab.id !== activeTab.id && !isRestrictedUrl(tab.url)) {
            const tabData = {
                id: tab.id.toString(),
                title: tab.title,
                url: tab.url,
                favicon: tab.favIconUrl,
                closedTimestamp: Date.now()
            };
            
            masterClosedTabs.unshift(tabData); // Add to master list
            newClosedTabs.push(tabData); // Collect for the unprocessed list
            tabsToRemove.push(tab.id);
        }
    });
    
    // Prepend new closed tabs to the global unprocessed list
    unprocessedTabs.unshift(...newClosedTabs);
    
    // Update master list size limit
    masterClosedTabs = masterClosedTabs.slice(0, 100);

    // Crucially, clear the grouped tabs storage to force a regroup/re-integration on next open
    await chrome.storage.local.remove(GROUPED_TABS_KEY); 

    // Remove tabs
    if (tabsToRemove.length > 0) {
        await chrome.tabs.remove(tabsToRemove);
    }

    // Save updated master list and unprocessed list
    await saveStoredTabs();
    console.log('Tab organization process complete. Tabs moved to unprocessed storage.');
}


// Get all tabs in the current window
function getTabs(sendResponse) {
  chrome.tabs.query({ currentWindow: true }, (tabs) => {
    sendResponse({ tabs: tabs.filter(tab => !isRestrictedUrl(tab.url)) });
  });
}

// Check if a URL is restricted (e.g., Chrome internal pages)
function isRestrictedUrl(url) {
  return url.startsWith('chrome://') ||
    url.startsWith('https://chrome.google.com/webstore') ||
    url.startsWith('chrome-extension://') ||
    url.startsWith('chrome://extensions');
}

// Load stored tabs when the extension is installed or updated
chrome.runtime.onInstalled.addListener(() => {
  loadStoredTabs();
});

// Load stored tabs when the background script starts
loadStoredTabs();

// Add this listener for tab changes
chrome.tabs.onActivated.addListener((activeInfo) => {
  chrome.tabs.get(activeInfo.tabId, (tab) => {
    if (tab && !isRestrictedUrl(tab.url)) {
      updateActiveTabInSidepanel(tab);
    }
  });
});

// Add this listener for tab updates (e.g., when URL changes or loading completes)
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  // 1. Handle Active Tab Update
  if (changeInfo.status === 'complete' && tab.active && !isRestrictedUrl(tab.url)) {
    updateActiveTabInSidepanel(tab);
  }

  // 2. Handle Group Tab Final Data Update (CRITICAL FIX)
  if (changeInfo.status === 'complete' && tab.groupId !== -1 && !isRestrictedUrl(tab.url)) {
    await updateStorageWithFinalTabInfo(tab);
  }
});

// Function to update the active tab in the sidepanel
function updateActiveTabInSidepanel(tab) {
  chrome.runtime.sendMessage({
    action: "updateActiveTab",
    tabId: tab.id.toString(),
    url: tab.url,
    title: tab.title // Add the title for more accurate matching
  });
}

// Add this helper function to check if regrouping is needed
function needsRegrouping(currentTabs, storedGrouping) {
  // Get all tab IDs from current tabs
  const currentTabIds = new Set(currentTabs.map(tab => tab.id.toString()));

  // Get all tab IDs from stored grouping
  const storedTabIds = new Set();

  // Check groups
  if (storedGrouping.groups) {
    storedGrouping.groups.forEach(group => {
      group.subgroups.forEach(subgroup => {
        subgroup.tabs.forEach(tab => storedTabIds.add(tab.id));
      });
    });
  }

  // Check ungrouped
  if (storedGrouping.ungrouped) {
    storedGrouping.ungrouped.forEach(tab => storedTabIds.add(tab.id));
  }

  // Compare sizes and contents
  if (currentTabIds.size !== storedTabIds.size) return true;

  for (const id of currentTabIds) {
    if (!storedTabIds.has(id)) return true;
  }

  return false;
}

// Add this function to handle creating and opening tab groups
async function openTabsInGroup(tabs, groupTitle) {
  try {
    // Create new tabs
    const createdTabs = await Promise.all(tabs.map(tab =>
      chrome.tabs.create({ url: tab.url, active: false })
    ));

    // Get the IDs of created tabs
    const tabIds = createdTabs.map(tab => tab.id);

    // Create a new tab group and get its ID
    const groupId = await chrome.tabs.group({ tabIds });

    // Set the group title
    await chrome.tabGroups.update(groupId, {
      title: groupTitle,
      collapsed: false
    });

    // Link the new live ID to the stored AI structure
    await linkLiveGroupToStorage(groupTitle, groupId);

    // Initialize tracking for this group
    activeTabGroups.set(groupId, {
      title: groupTitle,
      tabs: createdTabs.map(tab => ({
        id: tab.id.toString(),
        title: tab.title || "New Tab",
        url: tab.url,
        favicon: tab.favIconUrl
      }))
    });

    return { 
      status: "success",
      groupId: groupId,
      tabs: createdTabs 
    };
  } catch (error) {
    console.error('Error opening tabs in group:', error);
    return { 
      status: "error", 
      message: error.message 
    };
  }
}

// Listen for tab creation events (Modified to use Placeholder function)
chrome.tabs.onCreated.addListener(async (tab) => {
    try {
        // We need the tab's full object to get groupId immediately
        const fullTab = await chrome.tabs.get(tab.id); 
        const groupId = fullTab.groupId;
        
        if (groupId === -1 || isRestrictedUrl(fullTab.url)) return; // Not in a group or restricted

        const group = await chrome.tabGroups.get(groupId);
        
        // Update our tracking
        if (!activeTabGroups.has(groupId)) {
            activeTabGroups.set(groupId, {
                title: group.title,
                tabs: []
            });
        }
        
        // Add the new tab to our tracking (use placeholder data)
        const groupData = activeTabGroups.get(groupId);
        groupData.tabs.push({
            id: fullTab.id.toString(),
            title: fullTab.title || "Loading...",
            url: fullTab.url || "",
            favicon: fullTab.favIconUrl
        });

        // Add a temporary entry to storage
        await updateStorageWithNewTabPlaceholder(groupId, fullTab); 
    } catch (error) {
        // Error here often means the tab was closed before we could get its data, which is fine
        console.warn('Error handling new tab creation event:', error.message);
    }
});

/**
 * NEW FUNCTION: Inserts a temporary tab object into the stored grouping.
 * This is called from chrome.tabs.onCreated where info might be incomplete.
 */
async function updateStorageWithNewTabPlaceholder(groupId, tab) {
    try {
        const result = await chrome.storage.local.get(['searchmate_groupedTabs']);
        let groupedTabs = result.searchmate_groupedTabs || { groups: [], ungrouped: [] };
        
        console.log('Inserting placeholder for new tab in group:', groupId);

        // Find the group by the injected 'liveChromeGroupId'
        const group = groupedTabs.groups.find(g => 
            g.liveChromeGroupId === groupId
        );

        if (group) {
            // Ensure the subgroup and tabs array exist
            if (!group.subgroups || group.subgroups.length === 0) {
                 group.subgroups = [{ title: "Grouped Tabs", tabs: [] }];
            }
            if (!group.subgroups[0].tabs) {
                group.subgroups[0].tabs = [];
            }
            
            // Add the temporary tab entry
            group.subgroups[0].tabs.push({
                id: tab.id.toString(),
                title: tab.title || "Loading...", // Use Loading text
                url: tab.url || "",
                favicon: tab.favIconUrl || ""
            });

            await chrome.storage.local.set({ searchmate_groupedTabs: groupedTabs });

            // Notify the sidepanel to refresh
            chrome.runtime.sendMessage({
                action: "tabGroupUpdated",
                groupedTabs: groupedTabs
            });
        }
    } catch (error) {
        console.error('Error adding new tab placeholder:', error);
    }
}

/**
 * NEW FUNCTION: Updates the temporary tab object with final, complete data.
 * This is called from chrome.tabs.onUpdated with status='complete'.
 */
async function updateStorageWithFinalTabInfo(tab) {
    try {
        const result = await chrome.storage.local.get(['searchmate_groupedTabs']);
        let groupedTabs = result.searchmate_groupedTabs || { groups: [], ungrouped: [] };
        let updated = false;

        // Iterate through groups and subgroups to find the tab by ID
        for (const group of groupedTabs.groups) {
            for (const subgroup of group.subgroups) {
                const index = subgroup.tabs.findIndex(t => t.id === tab.id.toString());
                
                if (index !== -1) {
                    // Tab found! Overwrite the old, incomplete data
                    subgroup.tabs[index] = {
                        id: tab.id.toString(),
                        title: tab.title,
                        url: tab.url,
                        favicon: tab.favIconUrl || "",
                        // Retain closedTimestamp if it exists (though shouldn't on a live tab)
                        closedTimestamp: subgroup.tabs[index].closedTimestamp 
                    };
                    updated = true;
                    break;
                }
            }
            if (updated) break;
        }

        if (updated) {
            await chrome.storage.local.set({ searchmate_groupedTabs: groupedTabs });
            console.log('Storage updated with FINAL tab info for:', tab.title);
            
            // Notify the sidepanel to refresh
            chrome.runtime.sendMessage({
                action: "tabGroupUpdated",
                groupedTabs: groupedTabs
            });
        }
    } catch (error) {
        console.error('Error updating storage with final tab info:', error);
    }
}

// Listen for tab group updates
chrome.tabGroups.onUpdated.addListener((group) => {
  if (activeTabGroups.has(group.id)) {
    const groupData = activeTabGroups.get(group.id);
    groupData.title = group.title;
  }
});

// Listen for tab removals
chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  // Update active groups if needed
  activeTabGroups.forEach((groupData, groupId) => {
    groupData.tabs = groupData.tabs.filter(tab => tab.id !== tabId.toString());
    if (groupData.tabs.length === 0) {
      activeTabGroups.delete(groupId);
    }
  });
});

// Function to find the AI-generated group by title and inject the live Chrome Group ID.
// FIX: Now searches both main group and subgroup titles to handle inconsistent titles from the UI.
async function linkLiveGroupToStorage(targetTitle, chromeGroupId) {
  try {
    const result = await chrome.storage.local.get(['searchmate_groupedTabs']);
    const groupedTabs = result.searchmate_groupedTabs || { groups: [], ungrouped: [] };

    // 1. Try to find a match on the main group title first
    let parentGroupToLink = groupedTabs.groups.find(g => g.title === targetTitle);

    if (!parentGroupToLink) {
      // 2. If no main group match, check if the title belongs to a subgroup
      for (const group of groupedTabs.groups) {
        const isSubgroup = group.subgroups.some(sg => sg.title === targetTitle);
        if (isSubgroup) {
          // Found the parent group that contains the subgroup title.
          parentGroupToLink = group;

          // Since the Chrome group was created with the subgroup title, update the 
          // live Chrome group title to match the main group title for consistency.
          await chrome.tabGroups.update(chromeGroupId, { title: parentGroupToLink.title });

          console.log(`Matched subgroup title '${targetTitle}', linking to parent group '${parentGroupToLink.title}'.`);
          break;
        }
      }
    }

    if (parentGroupToLink) {
      // CRITICAL: Inject the live group ID into the stored structure (always on the main group object)
      parentGroupToLink.liveChromeGroupId = chromeGroupId;
      await chrome.storage.local.set({ searchmate_groupedTabs: groupedTabs });
      console.log(`Successfully linked group '${parentGroupToLink.title}' with live ID ${chromeGroupId}.`);
    } else {
      console.warn(`Could not find stored group matching title: ${targetTitle}`);
    }
  } catch (error) {
    console.error('Error linking live group to storage:', error);
  }
}