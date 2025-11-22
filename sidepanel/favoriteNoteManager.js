import { createNoteCard, createEditorNoteCard } from './noteManager.js';

// Loads all favorite notes into the favorites-container
export function loadFavoriteNotes() {
    const favoritesContainer = document.getElementById('favorites-container');
    favoritesContainer.innerHTML = '';

    chrome.storage.local.get(['searchmate_notes', 'editor_notes'], (result) => {
        const clipNotes = (result.searchmate_notes || []).filter(note => note.favourite === true);
        const editorNotes = (result.editor_notes || []).filter(note => note.favourite === true);

        if (clipNotes.length === 0 && editorNotes.length === 0) {
            // Show empty state with animation
            const emptyMessage = document.getElementById('empty-favourite-message');
            emptyMessage.classList.remove('hidden');
        } 
        else {
            // Hide empty message and show notes
            document.getElementById('empty-favourite-message').classList.add('hidden');

            // Add editor notes first (most recent first)
            editorNotes.forEach(note => {
                favoritesContainer.appendChild(createEditorNoteCard(note));
            });

            // Then add clipped notes
            clipNotes.forEach(note => {
                favoritesContainer.appendChild(createNoteCard(note));
            });
        }
    });
}

// Attach click event for favorite tab to load favourite notes
export function initializeFavoriteTab() {
    const favoritesTabBtn = document.querySelector('.tab-btn[data-tab="favorites"]');
    if (favoritesTabBtn) {
        favoritesTabBtn.addEventListener('click', () => {
            loadFavoriteNotes();
        });
    }
}