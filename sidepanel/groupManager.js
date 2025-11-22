import { createTabElement } from './tabManager.js';

// Function to close all open dropdowns
export function closeAllDropdowns() {
    document.querySelectorAll('.group-dropdown, .subgroup-dropdown').forEach(dropdown => {
        dropdown.classList.add('hidden');
    });
}

// Close dropdowns when clicking outside
document.addEventListener('click', (e) => {
    if (!e.target.closest('.group-menu-btn') && !e.target.closest('.subgroup-menu-btn')) {
        console.log('dropdown clicked');
        closeAllDropdowns();
    }
});


export function createGroupElement(group, isUngrouped = false, isCollapsed = false) {
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

export function createSubgroupElement(subgroup, isCollapsed = false) {
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

function generateId() {
    return 'id_' + Math.random().toString(36).substr(2, 9);
}

export function handleGroupAction(action, group) {
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
}

export function handleSubgroupAction(action, subgroup) {
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
}