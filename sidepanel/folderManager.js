export function initializeFolderManagement() {
    console.log("Initializing Folder Management...");

    // Initialize existing folders
    loadFolders();

    const createFolderBtn = document.getElementById('create-folder');
    const folderDropdown = document.getElementById('folder-dropdown');
    const newTabFolderBtn = document.getElementById('new-tab-folder');
    const newYourFolderBtn = document.getElementById('new-your-folder');

    // Toggle dropdown menu
    createFolderBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const rect = createFolderBtn.getBoundingClientRect();
        folderDropdown.style.top = `${rect.bottom + 5}px`;
        folderDropdown.style.right = `${window.innerWidth - rect.right}px`;
        folderDropdown.classList.toggle('hidden');
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', () => {
        folderDropdown.classList.add('hidden');
    });

    // Create Tab Folder
    newTabFolderBtn.addEventListener('click', () => {
        createFolder('tab');
        folderDropdown.classList.add('hidden');
    });

    // Create Your Folder
    newYourFolderBtn.addEventListener('click', () => {
        createFolder('your');
        folderDropdown.classList.add('hidden');
    });
}

function createFolder(type) {
    const container = type === 'tab' ? 
        document.getElementById('tab-folders-container') : 
        document.getElementById('your-folders-container');
    
    const folderId = `folder-${Date.now()}`;
    const folderDiv = document.createElement('div');
    folderDiv.className = 'folder-item relative group';
    folderDiv.dataset.folderId = folderId;
    
    const iconSrc = type === 'tab' ? 
        'assets/images/tab_folder_btn.svg' : 
        'assets/images/your_folder_btn.svg';
    
    folderDiv.innerHTML = `
        <div id="${folderId}" class="flex flex-col items-center p-4 bg-white rounded-xl border border-gray-200 hover:shadow-md transition-all cursor-pointer">
            <img src="${iconSrc}" class="w-12 h-12 mb-2" alt="Folder">
            <span class="folder-name text-xs text-gray-700" contenteditable="false">New Folder</span>
        </div>
    `;

    container.appendChild(folderDiv);
    saveFolders();

    // Enable double-click to edit
    const nameSpan = folderDiv.querySelector('.folder-name');
    enableFolderNameEditing(nameSpan);
}

function enableFolderNameEditing(element) {
    element.addEventListener('dblclick', (e) => {
        e.stopPropagation(); // Stop event from bubbling up
        element.contentEditable = true;
        element.focus();
    });

    element.addEventListener('blur', () => {
        element.contentEditable = false;
        saveFolders();
    });

    element.addEventListener('keydown', (e) => {
        e.stopPropagation(); // Stop event from bubbling up
        if (e.key === 'Enter') {
            e.preventDefault();
            element.blur();
        }
    });
}

function saveFolders() {
    const folders = {
        tabFolders: [],
        yourFolders: []
    };

    // Save Tab Folders
    document.querySelectorAll('#tab-folders-container .folder-item').forEach(folder => {
        folders.tabFolders.push({
            id: folder.dataset.folderId,
            name: folder.querySelector('.folder-name').textContent
        });
    });

    // Save Your Folders
    document.querySelectorAll('#your-folders-container .folder-item').forEach(folder => {
        folders.yourFolders.push({
            id: folder.dataset.folderId,
            name: folder.querySelector('.folder-name').textContent
        });
    });

    chrome.storage.local.set({ folders: folders });
}

function loadFolders() {
    chrome.storage.local.get(['folders'], (result) => {
        if (result.folders) {
            
            console.log("Loaded folders from storage:", result.folders);

            // Load Tab Folders
            const tabContainer = document.getElementById('tab-folders-container');
            tabContainer.innerHTML = '';
            result.folders.tabFolders.forEach(folder => {
                createExistingFolder(folder, 'tab');
            });

            // Load Your Folders
            const yourContainer = document.getElementById('your-folders-container');
            yourContainer.innerHTML = '';
            result.folders.yourFolders.forEach(folder => {
                createExistingFolder(folder, 'your');
            });

            // Dispatch event when folders are loaded
            document.dispatchEvent(new CustomEvent('foldersLoaded'));
        }
    });
}

function createExistingFolder(folder, type) {
    const container = type === 'tab' ? 
        document.getElementById('tab-folders-container') : 
        document.getElementById('your-folders-container');
    
    const folderDiv = document.createElement('div');
    folderDiv.className = 'folder-item relative group';
    folderDiv.dataset.folderId = folder.id;
    
    const iconSrc = type === 'tab' ? 
        'assets/images/tab_folder_btn.svg' : 
        'assets/images/your_folder_btn.svg';
    
    folderDiv.innerHTML = `
        <div id="${folder.id}" class="flex flex-col items-center p-4 bg-white rounded-xl border border-gray-200 hover:shadow-md transition-all cursor-pointer">
            <img src="${iconSrc}" class="w-12 h-12 mb-2" alt="Folder">
            <span class="folder-name text-xs text-gray-700" contenteditable="false">${folder.name}</span>
        </div>
    `;

    container.appendChild(folderDiv);
    enableFolderNameEditing(folderDiv.querySelector('.folder-name'));
}

export function initializeFolderMoreOptions() {
    // Always re-select the elements
    let moreBtn = document.getElementById('folder-more-btn');
    let moreDropdown = document.getElementById('folder-more-dropdown');
    let renameBtn = document.getElementById('folder-rename');
    let deleteBtn = document.getElementById('folder-delete');
    let renameModal = document.getElementById('rename-folder-modal');
    let deleteModal = document.getElementById('delete-folder-modal');

    // Remove old listeners by replacing the node with a clone
    function replaceWithClone(id) {
        const oldElem = document.getElementById(id);
        if (!oldElem) return null;
        const newElem = oldElem.cloneNode(true);
        oldElem.parentNode.replaceChild(newElem, oldElem);
        return newElem;
    }

    moreBtn = replaceWithClone('folder-more-btn');
    moreDropdown = document.getElementById('folder-more-dropdown');
    renameBtn = replaceWithClone('folder-rename');
    deleteBtn = replaceWithClone('folder-delete');
    renameModal = document.getElementById('rename-folder-modal');
    deleteModal = document.getElementById('delete-folder-modal');

    // Now attach listeners as before
    moreBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        moreDropdown.classList.toggle('hidden');
    });

    document.addEventListener('click', () => {
        moreDropdown.classList.add('hidden');
    });

    renameBtn.addEventListener('click', () => {
        const currentFolderName = document.getElementById('current-folder-name').textContent;
        const input = document.getElementById('new-folder-name');
        input.value = currentFolderName;
        renameModal.classList.remove('hidden');
        input.focus();
    });

    deleteBtn.addEventListener('click', () => {
        deleteModal.classList.remove('hidden');
    });

    document.getElementById('cancel-rename').addEventListener('click', () => {
        renameModal.classList.add('hidden');
    });

    document.getElementById('confirm-rename').addEventListener('click', () => {
        const newName = document.getElementById('new-folder-name').value.trim();
        if (newName) {
            renameFolderInStorage(newName);
            renameModal.classList.add('hidden');
        }
    });

    document.getElementById('cancel-delete').addEventListener('click', () => {
        deleteModal.classList.add('hidden');
    });

    document.getElementById('confirm-delete').addEventListener('click', () => {
        deleteFolderFromStorage();
        deleteModal.classList.add('hidden');
    });
}

function renameFolderInStorage(newName) {
    const currentFolderName = document.getElementById('current-folder-name');
    const folderId = currentFolderName.closest('.folder-contents-container').dataset.folderId;

    chrome.storage.local.get(['folders'], (result) => {
        const folders = result.folders || { tabFolders: [], yourFolders: [] };
        
        // Update folder name in both tab and your folders
        ['tabFolders', 'yourFolders'].forEach(type => {
            const folderIndex = folders[type].findIndex(f => f.id === folderId);
            if (folderIndex !== -1) {
                folders[type][folderIndex].name = newName;
            }
        });

        // Save updated folders
        chrome.storage.local.set({ folders }, () => {
            // Update UI
            currentFolderName.textContent = newName;
            // Update folder name in main folder view
            const folderItem = document.querySelector(`[data-folder-id="${folderId}"] .folder-name`);
            if (folderItem) {
                folderItem.textContent = newName;
            }
        });
    });
}

function deleteFolderFromStorage() {
    const container = document.querySelector('.folder-contents-container');
    const folderId = container.dataset.folderId;

    chrome.storage.local.get(['folders', 'searchmate_notes', 'editor_notes'], (result) => {
        const folders = result.folders || { tabFolders: [], yourFolders: [] };
        
        // Remove folder from both tab and your folders
        folders.tabFolders = folders.tabFolders.filter(f => f.id !== folderId);
        folders.yourFolders = folders.yourFolders.filter(f => f.id !== folderId);

        // Remove folder association from notes
        const searchmateNotes = (result.searchmate_notes || []).map(note => {
            if (note.folderId === folderId) {
                delete note.folderId;
                delete note.folder;
            }
            return note;
        });

        const editorNotes = (result.editor_notes || []).map(note => {
            if (note.folderId === folderId) {
                delete note.folderId;
                delete note.folder;
            }
            return note;
        });

        // Save everything back to storage
        chrome.storage.local.set({ 
            folders, 
            searchmate_notes: searchmateNotes, 
            editor_notes: editorNotes 
        }, () => {
            // Return to main folder view
            document.getElementById('folder-contents-cont').classList.add('hidden');
            document.getElementById('noteview-cont').classList.remove('hidden');
            document.querySelector('[data-tab="folders"]').click();
            
            // Remove folder item from UI
            const folderItem = document.querySelector(`[data-folder-id="${folderId}"]`);
            if (folderItem) {
                folderItem.remove();
            }
        });
    });
}

// Call this function when initializing folder contents view
function initializeFolderContentsView() {
    initializeFolderMoreOptions();
}