export function fetchAndDisplayBookmarks() {
    chrome.bookmarks.getTree((bookmarkTreeNodes) => {
        const bookmarksList = document.getElementById('bookmarks-list');
        bookmarksList.innerHTML = '';

        // Helper function: Render bookmarks inside a folder
        function renderBookmarks(nodes) {
            return nodes.map(node => {
                if (node.children) {
                    // Folder inside folder (nested)
                    return `
                        <li class="ml-4">
                            <details class="group" open>
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
            <details class="group border border-gray-200 rounded-xl mb-2" open>
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