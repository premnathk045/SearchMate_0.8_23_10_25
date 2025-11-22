export function initializeSettings() {
    const restoreButton = document.getElementById('restore-grouping');
    const restoreStatus = document.getElementById('restore-status');
    const darkModeToggle = document.getElementById('darkModeToggle');
    const autoOrganizeToggle = document.getElementById('autoOrganizeToggle');
    const collapseViewToggle = document.getElementById('collapseViewToggle');
    const existingGroupToggle = document.getElementById('existing-group');
    const customInstructionToggle = document.getElementById('tab-cust-instruct');
    const customInstructionTextarea = document.getElementById('custom-instruction');
    const customInstructionContainer = document.getElementById('custom-instruction-container');

    // Set default value for "Use Existing Group" in local storage
    // chrome.storage.local.set({ existingGroup: true });

    // Check if backup exists and update UI accordingly
    function checkBackupStatus() {
        chrome.runtime.sendMessage({ action: "checkBackupExists" }, (response) => {
            if (response.exists) {
                restoreButton.disabled = false;
                chrome.storage.local.get(['backup_timestamp'], (result) => {
                    if (result.backup_timestamp) {
                        const date = new Date(result.backup_timestamp);
                        restoreButton.title = `Backup from: ${date.toLocaleString()}`;
                    }
                });
            } else {
                restoreButton.disabled = true;
                restoreButton.title = 'No backup available';
            }
        });
    }

    // Handle restore button click
    restoreButton.addEventListener('click', () => {
        restoreButton.disabled = true;
        chrome.runtime.sendMessage({ action: "restoreGrouping" }, (response) => {
            if (response.status === "success") {
                showToast('success', response.message);
                // Trigger UI refresh by sending message to update tab list
                chrome.runtime.sendMessage({ 
                    action: "getClosedTabs", 
                    forceRefresh: true 
                });
                // Notify all instances of the sidepanel to refresh
                chrome.runtime.sendMessage({ 
                    action: "refreshSidepanel" 
                });
            } else {
                showToast('error', response.message);
            }
            restoreButton.disabled = false;
            checkBackupStatus();
        });
    });

    // Add event listener for collapse view toggle
    if (collapseViewToggle) {
        collapseViewToggle.addEventListener('change', (e) => {
            const isCollapsed = e.target.checked;
            console.log('Collapsed View set to:', isCollapsed);
            chrome.storage.local.set({ collapsedView: isCollapsed }, () => {
                // Notify sidepanel to refresh with new collapse state
                chrome.runtime.sendMessage({ 
                    action: "refreshSidepanel",
                    forceRefresh: true 
                });
            });
        });
    }

    // Add event listener for existing group toggle
    if (existingGroupToggle) {
        existingGroupToggle.addEventListener('change', (e) => {
            const isEnabled = e.target.checked;
            chrome.storage.local.set({ existingGroup: isEnabled }, () => {
                console.log("Existing Group setting updated:", isEnabled);
            });
        });
    }

    // Add event listener for "Enable Custom Instruction" toggle
    if (customInstructionToggle) {
        customInstructionToggle.addEventListener('change', (e) => {
            const isEnabled = e.target.checked;
            chrome.storage.local.set({ tabcustom_Instruction: isEnabled }, () => {
                console.log('Custom Instruction Enabled:', isEnabled);
            });

            // Show or hide the "Custom Instruction" textarea
            if (isEnabled) {
                customInstructionContainer.classList.remove('hidden');
            } else {
                customInstructionContainer.classList.add('hidden');
            }
        });
    }

    // Add event listener for "Custom Instruction" textarea
    if (customInstructionTextarea) {
        customInstructionTextarea.addEventListener('input', (e) => {
            const instruction = e.target.value;
            chrome.storage.local.set({ custom_instruct_prompt: instruction }, () => {
                console.log('Custom Instruction Saved:', instruction);
            });
        });
    }

    // Load saved settings
    chrome.storage.local.get(['darkMode', 'autoOrganize', 'collapsedView', 'tabcustom_Instruction', 'custom_instruct_prompt', 'existingGroup'], (result) => {
        if (darkModeToggle) darkModeToggle.checked = result.darkMode || false;
        if (autoOrganizeToggle) autoOrganizeToggle.checked = result.autoOrganize || false;
        if (collapseViewToggle) collapseViewToggle.checked = result.collapsedView || false;

        // Load "Enable Custom Instruction" toggle state
        if (customInstructionToggle) {
            customInstructionToggle.checked = result.tabcustom_Instruction || false;
            if (result.tabcustom_Instruction) {
                customInstructionContainer.classList.remove('hidden');
            }
        }

        // Load "Custom Instruction" textarea value
        if (customInstructionTextarea && result.custom_instruct_prompt) {
            customInstructionTextarea.value = result.custom_instruct_prompt;
        }

        // Load "Use Existing Group" toggle state
        if (existingGroupToggle) {
            existingGroupToggle.checked = result.existingGroup ?? true; // default true ONLY if first time
        }

    });

    function showToast(type, message) {
        restoreStatus.textContent = message;
        restoreStatus.className = `toast ${type}`;
        restoreStatus.style.display = 'block';
        setTimeout(() => {
            restoreStatus.style.display = 'none';
        }, 3000);
    }

    // Initial check
    checkBackupStatus();



    function connectGoogleAccount() {
        chrome.identity.getAuthToken({ interactive: true }, function(token) {
            if (chrome.runtime.lastError) {
            // Handle error (e.g., user denied access, network issue)
            console.error("OAuth Error:", chrome.runtime.lastError.message);
            return;
            }
            
            console.log("Successfully retrieved access token:", token);
            // Now you can call the function to make the API request
            fetchUserInfo(token);
        });
    }

    function fetchUserInfo(token) {
        const init = {
            method: 'GET',
            headers: {
            'Authorization': 'Bearer ' + token, // Crucial for authorization
            'Content-Type': 'application/json'
            },
            'contentType': 'json'
        };

        // Example: Getting user's basic profile
        fetch('https://www.googleapis.com/oauth2/v1/userinfo?alt=json', init)
        .then(response => response.json())
        .then(data => {
        console.log("User Data:", data);
        // Update UI to show the user is connected
        showConnectedState(data);
        })
        .catch(error => {
        console.error("API Fetch Error:", error);
        });
    }

    function showConnectedState(user) {
        // Saving user data in chrome storage
        chrome.storage.local.set({
            googleUser: user,
            isGoogleConnected: true
        });
        
        // Fill UI
        document.getElementById('user-photo').src = user.picture;
        document.getElementById('user-name').textContent = `Connected as ${user.email}`;

        // Toggle visibility
        document.getElementById('connect-google-account').classList.add("hidden");
        document.getElementById('connected-state').classList.remove("hidden");
    }

    function disconnectGoogleAccount() {
        // Remove Chrome auth token
        chrome.identity.getAuthToken({ interactive: false }, function(token) {
            if (token) {
                chrome.identity.removeCachedAuthToken({ token: token }, function() {
                    console.log("Google account disconnected.");
                });
            }
        });

        // Clear storage
        chrome.storage.local.remove(["googleUser", "isGoogleConnected"]);

        // Reset UI
        document.getElementById('connected-state').classList.add("hidden");
        document.getElementById('connect-google-account').classList.remove("hidden");
    }

    // Event Listeners
    document.getElementById('connect-google-account')
        .addEventListener('click', connectGoogleAccount);

    document.getElementById('disconnect-google')
        .addEventListener('click', disconnectGoogleAccount);


    // Restore UI immediately when popup loads
    chrome.storage.local.get(["googleUser", "isGoogleConnected"], (data) => {
        if (data.isGoogleConnected && data.googleUser) {
            document.getElementById('user-photo').src = data.googleUser.picture;
            document.getElementById('user-name').textContent =
                `Connected as ${data.googleUser.email}`;

            document.getElementById('connect-google-account').classList.add("hidden");
            document.getElementById('connected-state').classList.remove("hidden");
        } else {
            document.getElementById('connected-state').classList.add("hidden");
            document.getElementById('connect-google-account').classList.remove("hidden");
        }
    });
        
}