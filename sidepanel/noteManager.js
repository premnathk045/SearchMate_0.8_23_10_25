import { initializeFolderMoreOptions } from './folderManager.js';

// Add note card creation
export function createNoteCard(note) {

    const noteContent = note.text || ''; // Use note.text for clipped notes
    const textPreview = getPlainTextPreview(noteContent, 120);
    const imageSrc = getFirstImageSrc(noteContent);
    const imagePreviewHTML = imageSrc ? `
        <div class="mt-3">
            <img src="${imageSrc}" alt="Note image preview" class="w-full h-24 object-cover rounded-lg border border-gray-100">
        </div>
    ` : '';

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
            <p class="text-sm text-gray-800 leading-relaxed whitespace-pre-line">${textPreview}</p>
            ${imagePreviewHTML}

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

    // Add click handler to show individual note
    card.addEventListener('click', (e) => {
        // Prevent click if delete button was clicked
        if (e.target.closest('.delete-note')) return;
        console.log('Showing individual note:', note.id);
        
        showIndividualNote({
            id: note.id,
            title: note.title,
            text: note.text,
            source: note.source,
            timestamp: note.timestamp,
            modifiedTimestamp: note.modifiedTimestamp,
            folder: note.folder || 'Uncategorized',
            favourite: note.favourite || false
        });
    });

    return card;
}


/**
 * Asynchronously retrieves the title and HTML content of the currently viewed note.
 * It reads the current note ID from the DOM element 'noteindiv-cont' and fetches 
 * the note content from chrome.storage.local, based on the assumption that
 * the 'saveNote()' function stores all notes in a list under the key 'notes'.
 * * @returns {Promise<{title: string, content: string}>} A promise that resolves to the note details.
 */
async function getCurrentNoteDetails() {
    const noteindivCont = document.getElementById('noteindiv-cont');
    const currentNoteId = noteindivCont ? noteindivCont.dataset.currentNoteId : null;

    if (!currentNoteId) {
        console.error("Export Error: No current note ID found in DOM.");
        return {
            title: 'Error: No Note Selected',
            content: '<h1>Export Error</h1><p>Please select a note before attempting to export.</p>'
        };
    }

    const storageData = await new Promise((resolve) => {
        chrome.storage.local.get(['searchmate_notes', 'editor_notes'], (result) => {
            console.log('Fetched notes from storage for export:', result);
            resolve(result);
        });
    });

    // FIX: merge the correct arrays
    const notes = [
        ...(storageData.editor_notes || []),
        ...(storageData.searchmate_notes || [])
    ];

    console.log ('combinednotes:', notes);
    const currentNote = notes.find(note => note.id === currentNoteId);
    console.log ('current note:', currentNote);

    if (currentNote) {
        const title = currentNote.title || 'Untitled Note';
        const content = currentNote.content || currentNote.text || '<h1>Empty Note</h1>';
        return { title, content };
    } else {
        console.error(`Export Error: Note with ID ${currentNoteId} not found in storage.`);
        return {
            title: 'Error: Note Not Found',
            content: `<h1>Export Error</h1><p>Note with ID ${currentNoteId} could not be found. It may have been deleted.</p>`
        };
    }
}


/**
 * Exports the note content (as HTML) to Google Drive, converting it to a Google Doc.
 * @param {string} noteTitle - The title of the note.
 * @param {string} noteContent - The HTML content of the note.
 * @returns {Promise<Object>} The file object returned by the Google Drive API.
 */
async function exportNoteToGoogleDocs(noteTitle, noteContent) {
    console.log("%c[EXPORT] Starting exportNoteToGoogleDocs()", "color: green; font-weight: bold;");
    console.log("[EXPORT] Incoming title:", noteTitle);
    console.log("[EXPORT] Incoming content length:", noteContent?.length);
    console.log("[EXPORT] Incoming content:", noteContent);
    console.log("[EXPORT] Incoming content type:", typeof noteContent);

    // Defensive: ensure we at least have a string for content
    if (noteContent == null) {
        console.warn('[EXPORT] noteContent is null/undefined — exporting empty document body.');
        noteContent = '';
    }

    // 1. Get Auth Token
    console.log("%c[EXPORT] Requesting OAuth token...", "color: blue;");
    const token = await new Promise((resolve, reject) => {
        chrome.identity.getAuthToken({ interactive: true }, (token) => {
            if (chrome.runtime.lastError || !token) {
                console.error("[EXPORT] Auth error:", chrome.runtime.lastError?.message);
                reject(new Error("Auth failed. See console for details."));
            } else {
                console.log("%c[EXPORT] OAuth token received successfully", "color: blue; font-weight: bold;");
                resolve(token);
            }
        });
    });

    // 2. Prepare API Request (Multipart)
    console.log("%c[EXPORT] Preparing multipart request...", "color: purple;");

    const title = noteTitle?.length > 0 ? noteTitle : "Untitled Note Export";
    console.log("[EXPORT] Final document title:", title);

    const boundary = 'SearchMateExportBoundary';
    console.log("[EXPORT] Boundary being used:", boundary);

    const metadata = {
        name: `${title} - ${new Date().toISOString().slice(0, 10)}`,
        mimeType: 'application/vnd.google-apps.document'
    };

    console.log("[EXPORT] Metadata JSON:", metadata);

    const body = [
        `--${boundary}`,
        'Content-Type: application/json; charset=UTF-8',
        '',
        JSON.stringify(metadata, null, 2),
        `--${boundary}`,
        'Content-Type: text/html',
        '',
        noteContent,
        `--${boundary}--`
    ].join('\r\n');

    console.log("[EXPORT] Multipart body prepared.");
    console.log("[EXPORT] Body preview (first 500 chars):", body.slice(0, 500));
    console.log("[EXPORT] Total body size:", new Blob([body]).size, "bytes");

    // 3. Perform the API Call
    const apiUrl = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart";
    console.log("%c[EXPORT] Sending POST request to Google Drive...", "color: brown; font-weight: bold;");
    console.log("[EXPORT] Request URL:", apiUrl);

    try {
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': `multipart/related; boundary="${boundary}"`,
            },
            body: body,
        });

        console.log("[EXPORT] Response status:", response.status);

        if (!response.ok) {
            const errorText = await response.text();
            console.error("[EXPORT] Google API returned error:", errorText);
            throw new Error(`Google Drive API failed: ${response.status} - ${errorText}`);
        }

        const file = await response.json();
        console.log("%c[EXPORT] Export successful!", "color: green; font-weight: bold;");
        console.log("[EXPORT] Google Drive file response:", file);

        return file;

    } catch (error) {
        console.error("%c[EXPORT] Export to Google Docs failed:", "color: red; font-weight: bold;", error);
        throw new Error(`Export failed: ${error.message}`);
    }
}

/**
 * Utility function to strip HTML and limit text for a preview.
 * @param {string} htmlContent - The full HTML content of the note.
 * @param {number} maxLength - The maximum number of characters for the preview.
 * @returns {string} The plain text preview.
 */
function getPlainTextPreview(htmlContent, maxLength = 100) {
    // 1. Create a temporary div to parse the HTML
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = htmlContent;

    // 2. Extract the text content and normalize whitespace
    const text = tempDiv.textContent || tempDiv.innerText || '';
    const cleanText = text.replace(/\s+/g, ' ').trim(); // Replace multiple spaces/newlines with a single space

    // 3. Truncate and add ellipsis if needed
    if (cleanText.length > maxLength) {
        return cleanText.substring(0, maxLength) + '...';
    }
    return cleanText;
}

/**
 * Utility function to find the source of the first image in the HTML.
 * @param {string} htmlContent - The full HTML content of the note.
 * @returns {string | null} The src attribute of the first <img> tag, or null.
 */
function getFirstImageSrc(htmlContent) {
    // Only search if content looks like HTML
    if (!htmlContent || !htmlContent.includes('<')) {
        return null;
    }
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = htmlContent;
    const firstImage = tempDiv.querySelector('img');
    return firstImage ? firstImage.src : null;
}


// Editor note card creation
export function createEditorNoteCard(note) {

    const textPreview = getPlainTextPreview(note.content, 120); // Get first 120 chars of plain text
    const imageSrc = getFirstImageSrc(note.content);            // Get the source of the first image

    const card = document.createElement('div');
    card.className = 'rounded-lg shadow';
    card.dataset.noteId = note.id;

    
    // Conditionally include the image preview HTML
    const imagePreviewHTML = imageSrc ? `
        <div class="mt-3">
            <img src="${imageSrc}" alt="Note image preview" class="w-full h-24 object-cover rounded-lg border border-gray-100">
        </div>
    ` : '';
    
    card.innerHTML = `
        <div class="relative bg-white border border-gray-200 rounded-xl shadow-sm hover:shadow-md transition-all p-4">
            <!-- Header: icon + date -->
            <div class="flex items-start justify-between gap-2 mb-2">
                <div class="flex gap-2">
                    <div class="flex-shrink-0 text-green-500 bg-[#edf2fa] rounded-full p-1">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" 
                            stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                    </div>
                    <div class="flex flex-col gap-1">
                        <span class="text-sm font-medium text-gray-700">Editor Note</span>
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

            <!-- Note content -->
            <p class="text-sm mb-2 text-gray-800 leading-relaxed note-content">${textPreview}</p> 
            ${imagePreviewHTML}

        </div>
    `;

    // Add delete handler
    card.querySelector('.delete-note').addEventListener('click', () => {
        chrome.storage.local.get(['editor_notes'], (result) => {
            const notes = result.editor_notes || [];
            const updatedNotes = notes.filter(n => n.id !== note.id);
            chrome.storage.local.set({ editor_notes: updatedNotes }, () => {
                card.remove();
                updateEmptyNotesMessage();
            });
        });
    });

    // Add click handler to show individual note
    card.addEventListener('click', (e) => {
        // Prevent click if delete button was clicked
        if (e.target.closest('.delete-note')) return;
        console.log('Showing individual note:', note.id);
        
        showIndividualNote({
            id: note.id,
            title: 'Editor Note',
            text: note.content,
            timestamp: note.timestamp,
            modifiedTimestamp: note.modifiedTimestamp,
            folder: note.folder || 'Uncategorized',
            favourite: note.favourite || false
        });
    });

    return card;
}


export function updateEmptyNotesMessage() {
    const notesContainer = document.getElementById('notes-container');
    const emptyMessage = document.getElementById('empty-notes-message');
    
    if (notesContainer.children.length === 0) {
        emptyMessage.classList.remove('hidden');
    } else {
        emptyMessage.classList.add('hidden');
    }
}


// notes empty animation instance
let notesEmptyAnimation = null;

// folder empty animation instance
let folderEmptyAnimation = null;

export function loadNotes() {
    
    const notesContainer = document.getElementById('notes-container');

    chrome.storage.local.get(['searchmate_notes', 'editor_notes'], (result) => {
        const clipNotes = result.searchmate_notes || [];
        const editorNotes = result.editor_notes || [];
        notesContainer.innerHTML = '';

        if (clipNotes.length === 0 && editorNotes.length === 0) {
            // Show empty state with animation
            const emptyMessage = document.getElementById('empty-notes-message');
            emptyMessage.classList.remove('hidden');

            // Only initialize animation if it doesn't exist
            if (!notesEmptyAnimation) {
                fetch(chrome.runtime.getURL('assets/loader/Empty Box.json'))
                    .then(response => response.json())
                    .then(animationData => {
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
            if (notesEmptyAnimation) {
                notesEmptyAnimation.destroy();
                notesEmptyAnimation = null;
            }
            // Add editor notes first (most recent first)
            editorNotes.forEach(note => {
                notesContainer.appendChild(createEditorNoteCard(note));
            });
            // Then add clipped notes
            clipNotes.forEach(note => {
                notesContainer.appendChild(createNoteCard(note));
            });
        }
    });

    // Notes tab switching functionality
    const tabs = document.querySelectorAll('.tab-btn');
    const sections = document.querySelectorAll('.note-tab');

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            // Remove active states
            tabs.forEach(t => t.classList.remove(
                'border-blue-500','pb-2','text-blue-600','border-b-2','px-4','py-2','text-sm','text-gray-900','bg-white','rounded-full','border-gray-100','hover:bg-gray-100','hover:text-blue-700'
            ));
            tabs.forEach(t => t.classList.add('text-gray-500'));

            // Hide all sections
            sections.forEach(s => s.classList.add('hidden'));

            // Activate selected tab
            tab.classList.remove('text-gray-500');
            tab.classList.add(
                'border-blue-500','pb-2','text-blue-600','border-b-2','px-4','py-2','text-sm','text-gray-900','bg-white','rounded-full','border-gray-100','hover:bg-gray-100','hover:text-blue-700'
            );

            // Show relevant section
            const selectedTab = tab.getAttribute('data-tab');
            document.getElementById(`${selectedTab}-tab`).classList.remove('hidden');
        });
    });

    // Initialize SunEditor
    const editor = SUNEDITOR.create(document.getElementById('notesEditor'), {
        height: 'auto',
        minHeight: '500px',
        maxHeight: '60vh',
        buttonList: [
            ['bold', 'italic', 'underline', 'strike'],
            ['align', 'list', 'link', 'image'],
            ['fontSize', 'fontColor'],
        ],
        // Add these new options
        imageURLInput: true,
        imageUploadSizeLimit: 5242880, // 5MB
        imageAccept: 'image/*',
        imageFileInput: false, // Set to true if you want to allow file uploads
        formats: ['p', 'div', 'pre', 'figure', 'img', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
        attributesWhitelist: {
            all: 'style,href,src,target',
            img: 'src,alt,width,height'
        },
        mode: 'classic',
        FontFace: ['poppins'],
        placeholder: 'Write your notes or drag and drop anything...',
        katex: null,
        resizingBar: false,
    });

    console.log('SunEditor initialized:', editor);

    // Initialize edit note functionality
    initializeEditNote(editor);

    // Initialize folder selection
    initializeFolderSelect();

    // Listen for messages to insert into editor
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === "insertToEditor") {
            // Format the text with source attribution
            const formattedText = `
                ${request.text}
                
                <p class="text-xs text-gray-500">
                    Source: <a href="${request.source}" target="_blank">${request.title}</a>
                </p>
                <hr class="my-4">
            `;

            try {
                // Insert at current cursor position
                editor.insertHTML(formattedText, true, true);
            } catch (e) {
                // Fallback: append at end
                const currentContent = editor.getContents();
                editor.setContents(currentContent + formattedText);
            }

            // Switch to notes tab (if not active)
            document.querySelector('[data-tab="notes"]').click();

            // Show editor create view
            document.getElementById("noteview-cont").classList.add("hidden");
            document.getElementById("notecreate-cont").classList.remove("hidden");
        }
    });

    // Move toolbar to bottom
    const toolbar = document.querySelector('.sun-editor .se-toolbar');
    if (toolbar) {
        toolbar.style.position = 'fixed';
        toolbar.style.bottom = '80px';
        toolbar.style.left = '8%';
        toolbar.style.width = '84%';
        toolbar.style.borderRadius = '10px';
        toolbar.style.zIndex = '9999';
        toolbar.style.background = '#fff';
        toolbar.style.borderTop = '1px solid #e5e7eb';
        toolbar.style.boxShadow = '0 -2px 8px rgba(0,0,0,0.05)';
        toolbar.style.padding = '6px 0';
    }

    // Style editor area
    const editorContainer = document.querySelector('.sun-editor');
    if (editorContainer) {
        editorContainer.style.border = 'none';
        editorContainer.style.width = '96%';
        editorContainer.style.borderRadius = '12px';
        editorContainer.style.boxShadow = '0 2px 6px rgba(0,0,0,0.05)';
        editorContainer.style.paddingBottom = '48px';
        editorContainer.style.margin = 'auto';
        editorContainer.style.backgroundColor = '#fff';
    }

    function noteSwitching() {
        const addNoteBtn = document.getElementById("addnote");
        const backToNotesBtn = document.getElementById("back-to-notes");
        const noteViewContainer = document.getElementById("noteview-cont");
        const noteCreateContainer = document.getElementById("notecreate-cont");

        addNoteBtn.addEventListener("click", () => {
            noteViewContainer.classList.add("hidden");
            noteCreateContainer.classList.remove("hidden");
        });

        backToNotesBtn.addEventListener("click", () => {
            // Clear editor and reset
            resetNoteEditor();
            noteCreateContainer.classList.add("hidden");
            noteViewContainer.classList.remove("hidden");
        });
    }
    // Initialize note switching functionality
    noteSwitching();


    // Initialize note navigation
    initializeNoteNavigation();


    // Getting new notes to local storage
    const saveNoteBtn = document.getElementById("save-note-btn");
    saveNoteBtn.addEventListener("click", saveNote);

    function saveNote() {
        const createContainer = document.getElementById('notecreate-cont');
        console.log('createContainer:', createContainer);
        const noteContent = editor.getContents(true); // Get contents with HTML formatting
        const editingNoteId = createContainer.dataset.editingNoteId;
        console.log('Saving note. Editing Note ID:', editingNoteId);

        // Add folder information to the note object
        const folderInfo = selectedFolder ? {
            folderId: selectedFolder.id,
            folder: selectedFolder.name
        } : {};
        
        if (editingNoteId) {
            // Update existing note
            const now = new Date().toISOString(); // Capture current modification time

            chrome.storage.local.get(['searchmate_notes', 'editor_notes'], (result) => {
                let notes = result.editor_notes || [];
                let searchmateNotes = result.searchmate_notes || [];
                
                // Check in editor notes
                let noteIndex = notes.findIndex(n => n.id === editingNoteId);
                if (noteIndex !== -1) {
                    // Update editor note
                    notes[noteIndex] = {
                        ...notes[noteIndex],
                        content: noteContent,
                        modifiedTimestamp: now,
                        ...folderInfo
                    };
                    
                    chrome.storage.local.set({ editor_notes: notes }, () => {
                        updateNoteCard(editingNoteId, notes[noteIndex]);
                        resetNoteEditor();
                    });
                } else {
                    // Check in searchmate notes
                    noteIndex = searchmateNotes.findIndex(n => n.id === editingNoteId);
                    if (noteIndex !== -1) {
                        // Update searchmate note
                        searchmateNotes[noteIndex] = {
                            ...searchmateNotes[noteIndex],
                            text: noteContent,
                            modifiedTimestamp: now,
                            ...folderInfo
                        };
                        
                        chrome.storage.local.set({ searchmate_notes: searchmateNotes }, () => {
                            updateNoteCard(editingNoteId, searchmateNotes[noteIndex]);
                            resetNoteEditor();
                        });
                    }
                }
            });
        } else {
            // Create new note with HTML content
            const noteId = 'editor_' + Date.now();
            const now = new Date().toISOString(); // Capture creation time once
            const note = {
                id: noteId,
                content: noteContent,
                timestamp: now,
                modifiedTimestamp: now, // Set modification time to creation time
                ...folderInfo
            };
            
            chrome.storage.local.get(['editor_notes'], (result) => {
                const notes = result.editor_notes || [];
                notes.unshift(note);
                chrome.storage.local.set({ editor_notes: notes }, () => {
                    const noteCard = createEditorNoteCard(note);
                    const notesContainer = document.getElementById('notes-container');
                    notesContainer.insertBefore(noteCard, notesContainer.firstChild);
                    resetNoteEditor();
                });
            });
        }
    }

    function resetNoteEditor() {
        const createContainer = document.getElementById('notecreate-cont');
        editor.setContents('');
        createContainer.dataset.editingNoteId = '';
        document.getElementById('save-note-btn').textContent = 'Save Note';

        // Reset folder selection
        selectedFolder = null;
        const selectFolderBtn = document.getElementById('select-folder-btn');
        selectFolderBtn.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                    d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
            </svg>
            Folder
            <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 ml-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
            </svg>
        `;

        createContainer.classList.add('hidden');
        document.getElementById('noteview-cont').classList.remove('hidden');
        updateEmptyNotesMessage();
    }

    function updateNoteCard(noteId, note) {
        console.log('existing note update clicked');
        const existingCard = document.querySelector(`[data-note-id="${noteId}"]`);
        if (existingCard) {
            console.log('Updating note card for note ID:', noteId);
            const newCard = note.content ? createEditorNoteCard(note) : createNoteCard(note);
            existingCard.replaceWith(newCard);
        }
    }


    // Initialize folder clicks
    initializeFolderClicks();
    console.log('Folder clicks initialized');
    initializeFolderNavigation();

}

// Cleanup animation when switching away from notes
export function cleanupNotesAnimation(notesEmptyAnimation) {
    console.log('cleaning up notes animation');
    if (notesEmptyAnimation) {
        notesEmptyAnimation.destroy();
        notesEmptyAnimation = null;
    }
}

// Folder selection handling
let selectedFolder = null;

// Add this function to handle folder selection dropdown
function initializeFolderSelect() {
    const selectFolderBtn = document.getElementById('select-folder-btn');
    const folderDropdown = document.getElementById('folder-select-dropdown');

    selectFolderBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const rect = selectFolderBtn.getBoundingClientRect();
        folderDropdown.style.top = `${rect.bottom + 5}px`;
        folderDropdown.style.left = `${rect.left}px`;
        
        // Load folders and show dropdown
        chrome.storage.local.get(['folders'], (result) => {
            const folders = result.folders || { tabFolders: [], yourFolders: [] };
            const allFolders = [...folders.tabFolders, ...folders.yourFolders];
            
            folderDropdown.querySelector('ul').innerHTML = allFolders.map(folder => `
                <li>
                    <button class="w-full px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 text-left" 
                            data-folder-id="${folder.id}" 
                            data-folder-name="${folder.name}">
                        ${folder.name}
                    </button>
                </li>
            `).join('');
            
            folderDropdown.classList.remove('hidden');
        });
    });

    // Handle folder selection
    folderDropdown.addEventListener('click', (e) => {
        const folderBtn = e.target.closest('button');
        if (folderBtn) {
            selectedFolder = {
                id: folderBtn.dataset.folderId,
                name: folderBtn.dataset.folderName
            };
            selectFolderBtn.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                        d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
                </svg>
                ${selectedFolder.name}
                <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 ml-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                </svg>
            `;
            folderDropdown.classList.add('hidden');
        }
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', () => {
        folderDropdown.classList.add('hidden');
    });
}



// Show individual note
function showIndividualNote(note) {
    // Hide other containers
    document.getElementById('noteview-cont').classList.add('hidden');
    document.getElementById('notecreate-cont').classList.add('hidden');
    document.getElementById('folder-contents-cont').classList.add('hidden');

    // Determine the correct timestamps
    const createdAt = new Date(note.timestamp);
    // Use modifiedTimestamp if it exists, otherwise fall back to original timestamp
    const modifiedAt = new Date(note.modifiedTimestamp || note.timestamp);

    // Show individual note container
    const individualContainer = document.getElementById('noteindiv-cont');
    individualContainer.classList.remove('hidden');

    console.log('Showing individual note:', note);
    // Add note ID to the container
    individualContainer.dataset.currentNoteId = note.id;

    // Attach the raw content (which contains the img tags) to a data attribute
    individualContainer.dataset.currentNoteContent = note.text || note.content;
    
    // Get the content container
    const contentContainer = document.getElementById('individual-note-content');
    
    // Format the note content
    let noteHTML = `
        <div class="mb-6">
            <h1 class="text-xl font-semibold text-gray-900 mb-4">${note.title}</h1>

            <div class="flex-col gap-2 space-y-2 text-sm text-gray-700 mt-4 mb-4">
                <div class="flex items-center gap-2 mb-2">
                    <span class="font-medium text-gray-800 w-25 ">Created at</span>
                    <span class="text-gray-600">${createdAt.toLocaleDateString('en-GB', {
                    day: '2-digit', month: 'long', year: 'numeric'
                    })}, ${createdAt.toLocaleTimeString([], {
                    hour: '2-digit', minute: '2-digit'
                    })}</span>
                </div>

                <div class="flex items-center gap-2 mb-2">
                    <span class="font-medium text-gray-800 w-25">Last Modified</span>
                    <span class="text-gray-600">${modifiedAt.toLocaleDateString('en-GB', {
                    day: '2-digit', month: 'long', year: 'numeric'
                    })}, ${modifiedAt.toLocaleTimeString([], {
                    hour: '2-digit', minute: '2-digit'
                    })}</span>
                </div>

                <div class="flex items-center gap-2 mb-2">
                    <span class="font-medium text-gray-800 w-25">Folder</span>
                    <span class="bg-green-100 text-green-800 px-2 py-2 rounded-md text-xs font-medium">
                    ${note.folder || 'Uncategorized'}
                    </span>
                </div>

                ${note.source ? `<div class="flex items-center gap-2 mb-2"><span class="font-medium text-gray-800 w-25">Source</span><span><a href="${note.source}" target="_blank" class="text-blue-600 hover:underline">View Source</a></span></div>` : ''}
            </div>

            <div class="mt-6 prose max-w-none">
                ${note.text}
            </div>
        </div>
    `;

    
    contentContainer.innerHTML = noteHTML;

    // --- FAVOURITE BUTTON HANDLING BEGINS ---
    const favorBtn = document.getElementById('favor-note-btn');
    if (favorBtn) {
        // Set initial state (filled or not) based on note.favourite
        updateFavoriteButtonUI(favorBtn, note.favourite);

        favorBtn.onclick = function () {
            // Toggle favourite state
            const isFav = !(note.favourite === true);
            note.favourite = isFav;

            // Update UI
            updateFavoriteButtonUI(favorBtn, isFav);

            // Update in storage (both editor_notes and searchmate_notes)
            chrome.storage.local.get(['editor_notes', 'searchmate_notes'], (result) => {
                let updated = false;
                let { editor_notes = [], searchmate_notes = [] } = result;
                let noteType = ''; // To track which array was updated
                let noteToUpdate = null;

                // Try to update in editor_notes
                let idx = editor_notes.findIndex(n => n.id === note.id);
                if (idx !== -1) {
                    editor_notes[idx].favourite = isFav;
                    noteType = 'editor_notes';
                    noteToUpdate = editor_notes[idx];
                    updated = true;
                }

                // Try to update in searchmate_notes
                idx = searchmate_notes.findIndex(n => n.id === note.id);
                if (idx !== -1) {
                    searchmate_notes[idx].favourite = isFav;
                    noteType = 'searchmate_notes';
                    noteToUpdate = searchmate_notes[idx];
                    updated = true;
                }

                // Save back if changed
                if (updated) {
                    // Determine the correct storage object to set
                    const storageUpdate = {};
                    if (noteType === 'editor_notes') {
                        storageUpdate.editor_notes = editor_notes;
                    } else if (noteType === 'searchmate_notes') {
                        storageUpdate.searchmate_notes = searchmate_notes;
                    }

                    chrome.storage.local.set(storageUpdate, () => {
                        console.log(`Favorite status updated for note ${note.id}. New status: ${isFav}`);
                        
                        // Force a reload of all notes to ensure data consistency
                        loadNotes(); 
                    });
                }
            });
        };
    }
    // --- FAVOURITE BUTTON HANDLING ENDS ---

}

// Helper to update the favorite button UI (filled or outline heart)
function updateFavoriteButtonUI(btn, isFav) {
    if (!btn) return;
    // You can update the SVG or add/remove a class for filled/outline
    if (isFav === true) {
        btn.classList.add('text-red-500');
        btn.title = "Remove Favorite";
        // Optionally, swap SVG to filled heart
        btn.querySelector('svg path').setAttribute('fill', '#ef4444');
        btn.querySelector('svg path').setAttribute('stroke', '#ef4444');
    } else {
        btn.classList.remove('text-red-500');
        btn.title = "Add Favorite";
        btn.querySelector('svg path').setAttribute('fill', '4F4F4F');
        btn.querySelector('svg path').setAttribute('stroke', '4F4F4F');
    }
}

// Edit note functionality
function initializeEditNote(editor) {
    const editNoteBtn = document.getElementById('edit-note-btn');
    if (editNoteBtn) {
        editNoteBtn.addEventListener('click', () => {
            const individualContainer = document.getElementById('noteindiv-cont');
            const noteId = individualContainer.dataset.currentNoteId;
            
            // Get raw HTML content from the data attribute
            const rawNoteContent = individualContainer.dataset.currentNoteContent;
            
            // Switch to create note view
            individualContainer.classList.add('hidden');
            const createContainer = document.getElementById('notecreate-cont');
            createContainer.classList.remove('hidden');
            
            // Clear the editor first
            editor.setContents('');
            
            // Set the content with the raw HTML
            setTimeout(() => {
                console.log('Content being loaded into editor:', rawNoteContent);
                // Set the raw HTML content directly
                editor.setContents(rawNoteContent);       
            }, 100);
            
            // Store the note ID being edited
            createContainer.dataset.editingNoteId = noteId;
            
            // Change save button text
            const saveBtn = document.getElementById('save-note-btn');
            saveBtn.textContent = 'Update Note';
        });
    }
}

// Add back button handler
export function initializeNoteNavigation() {
    const backToNoteview = document.getElementById('back-to-noteview');
    if (backToNoteview) {
        backToNoteview.addEventListener('click', () => {
            document.getElementById('noteindiv-cont').classList.add('hidden');
            document.getElementById('noteview-cont').classList.remove('hidden');
        });
    }
}

// new folder section code
function initializeFolderClicks() {
    console.log('Initializing folder clicks');
    
    // Function to attach click handlers
    function attachFolderClickHandlers() {
        document.querySelectorAll('#tab-folders-container .folder-item, #your-folders-container .folder-item')
        .forEach(folder => {
            // Remove existing click handler if any
            folder.removeEventListener('click', folderClickHandler);
            // Add click handler
            folder.addEventListener('click', folderClickHandler);
        });
    }

    // Folder click handler function
    function folderClickHandler(event) {
        // Prevent handling if clicking on editable name
        if (event.target.classList.contains('folder-name')) {
            return;
        }
        console.log('Folder clicked:', this);
        const folderId = this.dataset.folderId;
        const folderName = this.querySelector('.folder-name').textContent;
        showFolderContents(folderId, folderName);
    }

    // Attach handlers initially
    attachFolderClickHandlers();

    // Re-attach handlers when folders are loaded
    document.addEventListener('foldersLoaded', attachFolderClickHandlers);
    
    // Also attach handlers when tab is switched to folders
    document.querySelectorAll('.tab-btn').forEach(tab => {
        if (tab.getAttribute('data-tab') === 'folders') {
            tab.addEventListener('click', () => {
                setTimeout(attachFolderClickHandlers, 100);
            });
        }
    });
}


function showFolderContents(folderId, folderName) {
    // Hide other views
    document.getElementById('noteview-cont').classList.add('hidden');
    document.getElementById('notecreate-cont').classList.add('hidden');
    document.getElementById('noteindiv-cont').classList.add('hidden');
    
    // Show folder contents view
    const folderContentsContainer = document.getElementById('folder-contents-cont');
    folderContentsContainer.classList.remove('hidden');
    folderContentsContainer.dataset.folderId = folderId;
    
    // Update folder name in header
    document.getElementById('current-folder-name').textContent = folderName;
    
    // Initialize folder more options
    initializeFolderMoreOptions();

    // Load notes for this folder
    loadFolderNotes(folderId);
}

function loadFolderNotes(folderId) {
    const notesContainer = document.getElementById('folder-notes-container');
    const emptyMessage = document.getElementById('empty-folder-message');
    
    // Clear container
    notesContainer.innerHTML = '';
    
    // Get both types of notes
    chrome.storage.local.get(['searchmate_notes', 'editor_notes'], (result) => {
        const clipNotes = (result.searchmate_notes || []).filter(note => note.folderId === folderId);
        const editorNotes = (result.editor_notes || []).filter(note => note.folderId === folderId);
        
        if (clipNotes.length === 0 && editorNotes.length === 0) {
            emptyMessage.classList.remove('hidden');
            initializeEmptyFolderAnimation();
        } else {
            emptyMessage.classList.add('hidden');
            
            // Add editor notes first (most recent first)
            editorNotes.forEach(note => {
                notesContainer.appendChild(createEditorNoteCard(note));
            });
            
            // Then add clipped notes
            clipNotes.forEach(note => {
                notesContainer.appendChild(createNoteCard(note));
            });
        }
    });
}

function initializeEmptyFolderAnimation() {
    // Cleanup existing animation if any
    if (folderEmptyAnimation) {
        folderEmptyAnimation.destroy();
        folderEmptyAnimation = null;
    }

    fetch(chrome.runtime.getURL('assets/loader/Empty Box.json'))
        .then(response => response.json())
        .then(animationData => {
            folderEmptyAnimation = lottie.loadAnimation({
                container: document.getElementById('empty-folder-animation'),
                renderer: 'svg',
                loop: true,
                autoplay: true,
                animationData: animationData
            });
        })
        .catch(error => console.error('Error loading empty folder animation:', error));
}

// Add back button handler for folder contents
function initializeFolderNavigation() {
    const backToFolders = document.getElementById('back-to-folders');
    if (backToFolders) {
        backToFolders.addEventListener('click', () => {
            // Cleanup animation
            if (folderEmptyAnimation) {
                folderEmptyAnimation.destroy();
                folderEmptyAnimation = null;
            }
            
            document.getElementById('folder-contents-cont').classList.add('hidden');
            document.getElementById('noteview-cont').classList.remove('hidden');
            // Switch to folders tab
            document.querySelector('[data-tab="folders"]').click();
        });
    }
}

// --- Share Note Sheet Functionality ---
export function initializeShareNote() {
    const shareNoteBtn = document.getElementById('share-note-btn');
    const shareModal = document.getElementById('share-note-modal');
    const shareSheet = document.getElementById('share-sheet');
    const closeBtn = document.getElementById('close-share-modal');
    const overlay = document.getElementById('share-overlay');

    // Function to show the modal with slide-up animation
    function showShareModal() {
        shareModal.classList.remove('hidden');
        // Use a slight delay to allow the 'hidden' class removal to register
        // before starting the transition
        console.log('Showing share modal');
        setTimeout(() => {
            shareSheet.classList.remove('translate-y-full');
        }, 50);
    }

    // Function to hide the modal with slide-down animation
    function hideShareModal() {
        console.log('closing share modal');
        shareModal.classList.add('hidden');
        shareSheet.classList.add('translate-y-full');
        // Wait for the transition to finish (300ms duration) before hiding the modal
        shareSheet.addEventListener('transitionend', function handler() {
            if (shareSheet.classList.contains('translate-y-full')) {
                shareModal.classList.add('hidden');
                shareSheet.removeEventListener('transitionend', handler);
            }
        });
    }

    // 1. Show modal when Share button is clicked
    if (shareNoteBtn) {
        shareNoteBtn.addEventListener('click', showShareModal);
    }

    // 2. Hide modal when Close button is clicked
    if (closeBtn) {
        closeBtn.addEventListener('click', hideShareModal);
    }

    // 3. Hide modal when overlay is clicked
    if (overlay) {
        overlay.addEventListener('click', hideShareModal);
    }

    // 4. Implement sharing button actions
    const exportDocsBtn = document.getElementById('export-google-docs');
    const shareEmailBtn = document.getElementById('share-via-email');

    if (exportDocsBtn) {
        exportDocsBtn.addEventListener('click', async () => {

            // 1. Attempt to get note details
            let noteData;
            try {
                console.log('[UI] Waiting for getCurrentNoteDetails()...');
                noteData = await getCurrentNoteDetails();
                console.log('[UI] Resolved:', noteData);
            } catch (err) {
                console.error('[UI] Failed to get note:', err);
                const statusElement = document.getElementById('export-status-message');
                if (statusElement) {
                    statusElement.classList.remove('hidden');
                    statusElement.textContent = 'Failed to read note. See console.';
                }
                return;
            }

            const title = noteData?.title ?? "Untitled Note";
            const content = noteData?.content ?? "";
            console.log("Note data:", { title, contentLength: content.length });

            const statusElement = document.getElementById('export-status-message');
            if (statusElement) {
                statusElement.classList.remove('hidden');
                statusElement.textContent = 'Exporting to Google Drive...';
            }

            try {
                // 2. Export to Google Docs
                const file = await exportNoteToGoogleDocs(title, content);

                if (statusElement) {
                    statusElement.textContent = `Success! Document "${file.name}" created in Google Drive.`;
                }

                // 3. Open created doc
                if (file?.webViewLink) {
                    chrome.tabs.create({ url: file.webViewLink });
                } else if (file?.id) {
                    chrome.tabs.create({ url: `https://docs.google.com/document/d/${file.id}/edit` });
                }

                // hide after 5 seconds
                if (statusElement) {
                    setTimeout(() => {
                        statusElement.textContent = '';
                        statusElement.classList.add('hidden');
                        hideShareModal();
                    }, 5000);
                }

            } catch (error) {
                console.error("Export error:", error);
                if (statusElement) {
                    statusElement.textContent = `Export Error: ${error.message}`;
                }
            }
        });
    }

    if (shareEmailBtn) {
        shareEmailBtn.addEventListener('click', () => {
            const noteId = document.getElementById('noteindiv-cont').dataset.currentNoteId;
            alert(`Sharing note ${noteId} via Email (Logic to be implemented).`);
            hideShareModal();
        });
    }
}


