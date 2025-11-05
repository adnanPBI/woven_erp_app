document.addEventListener('DOMContentLoaded', () => {
         const loginModal = new bootstrap.Modal(document.getElementById('loginModal'), {
             backdrop: 'static',
             keyboard: false
         });
         const registerModal = new bootstrap.Modal(document.getElementById('registerModal'));
         const userPrivilegeModal = new bootstrap.Modal(document.getElementById('userPrivilegeModal'));
         let currentUser = null;

         // Check if already logged in
         fetch('/main/api/current-user', { credentials: 'include' })
             .then(response => {
                 if (!response.ok) {
                     throw new Error(`HTTP error! status: ${response.status}`);
                 }
                 return response.json();
             })
             .then(data => {
                 if (data.user) {
                     currentUser = data.user;
                     loginModal.hide();
                     showMainUI();
                 } else {
                     loginModal.show();
                 }
             })
             .catch(error => {
                 console.error('Error checking current user:', error);
                 alert(`Login check failed: ${error.message}`);
                 loginModal.show();
             });


    // Add this to main.js
function logDebug(context, message, data = null) {
    console.log(`[${context}] ${message}`);
    if (data !== null) {
        console.log(`[${context}] Data:`, data);
    }
}



    // Login
    document.getElementById('loginBtn').addEventListener('click', () => {
        const username = document.getElementById('loginUsername').value.trim();
        const password = document.getElementById('loginPassword').value.trim();

        if (!username || !password) {
            alert('Please enter both username and password');
            return;
        }

        fetch('/main/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password }),
            credentials: 'include'
        })
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            if (data.error) {
                alert(data.error);
                return;
            }
            currentUser = data.user;
            loginModal.hide();
            showMainUI();
        })
        .catch(error => {
            console.error('Login error:', error);
            alert('Failed to login');
        });
    });

    // Show registration modal
    document.getElementById('showRegisterModal').addEventListener('click', (e) => {
        e.preventDefault();
        loginModal.hide();
        registerModal.show();
    });

    // Register
    document.getElementById('registerBtn').addEventListener('click', () => {
        const username = document.getElementById('registerUsername').value.trim();
        const password = document.getElementById('registerPassword').value.trim();
        const confirmPassword = document.getElementById('confirmPassword').value.trim();

        if (!username || !password || !confirmPassword) {
            alert('Please fill in all fields');
            return;
        }

        if (password !== confirmPassword) {
            alert('Passwords do not match');
            return;
        }

        if (password.length < 8 || !/[A-Z]/.test(password) || !/[0-9]/.test(password) || !/[!@#$%^&*]/.test(password)) {
            alert('Password must be at least 8 characters long, contain an uppercase letter, a number, and a special character');
            return;
        }

        fetch('/main/api/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password }),
            credentials: 'include'
        })
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            if (data.error) {
                alert(data.error);
                return;
            }
            alert('Registration successful! Please login.');
            registerModal.hide();
            loginModal.show();
        })
        .catch(error => {
            console.error('Registration error:', error);
            alert('Failed to register');
        });
    });

    // Logout
    document.getElementById('logoutBtn').addEventListener('click', () => {
        fetch('/main/api/logout', {
            method: 'POST',
            credentials: 'include'
        })
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            if (data.error) {
                alert(data.error);
                return;
            }
            currentUser = null;
            document.getElementById('mainContainer').style.display = 'none';
            loginModal.show();
        })
        .catch(error => {
            console.error('Logout error:', error);
            alert('Failed to logout');
        });
    });

    // Update active users count
    // Replace the updateActiveUsers function in main.js
function updateActiveUsers() {
    fetch('/main/api/active-users', { 
        credentials: 'include',
        headers: {
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache'
        }
    })
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            // Update counter
            const userStatusElem = document.getElementById('userStatus');
            if (userStatusElem) {
                userStatusElem.innerHTML = `<i class="fas fa-users"></i> Active Users: ${data.count}`;
            }
            
            // Update active users list
            const usersListContainer = document.getElementById('activeUsersList');
            if (usersListContainer && data.users && data.users.length > 0) {
                usersListContainer.innerHTML = '';
                
                data.users.forEach(user => {
                    const userItem = document.createElement('div');
                    userItem.className = 'active-user-item py-1 border-bottom';
                    
                    // Different styling for admin vs regular users
                    const badgeClass = user.role === 'admin' ? 'bg-danger' : 'bg-primary';
                    
                    userItem.innerHTML = `
                        <span class="badge ${badgeClass} me-1">
                            ${user.role}
                        </span>
                        ${user.username}
                    `;
                    usersListContainer.appendChild(userItem);
                });
            } else if (usersListContainer) {
                usersListContainer.innerHTML = '<div class="text-center text-muted">No active users</div>';
            }
        })
        .catch(error => {
            console.error('Error fetching active users:', error);
        });
}

    // Show Main UI and apply RBAC
   // Replace the showMainUI function in main.js with this version
function showMainUI() {
    document.getElementById('mainContainer').style.display = 'block';
    updateActiveUsers();
    updateLoggedInUserDisplay(); // New function to display current user
    setInterval(updateActiveUsers, 60000); // Update every minute

    // Apply RBAC with better error handling
    try {
        console.log("Current user:", currentUser);
        
        // Check if privileges exist before logging
        if (currentUser && currentUser.privileges) {
            console.log("Current user privileges:", currentUser.privileges);
        } else {
            console.warn("No privileges found for user");
            // Initialize empty privileges if none exist
            if (currentUser) {
                currentUser.privileges = {};
            }
        }
        
        const cards = document.querySelectorAll('.kanban-card');
        cards.forEach(card => {
            try {
                // Check if data attributes exist
                if (!card.dataset || (!card.dataset.module && !card.dataset.sub_ui)) {
                    console.warn("Card is missing data attributes:", card);
                    return; // Skip this card
                }
                
                // Safely get attributes with fallback values
                const module = (card.dataset.module || '').toLowerCase();
                const subUi = (card.dataset.sub_ui || '').toLowerCase();
                
                if (!module || !subUi) {
                    console.warn(`Missing module or sub_ui attributes for card:`, card);
                    return; // Skip this card if attributes are missing
                }
                
                // Create the key for privilege check
                const key = `${module}_${subUi}`;
                
                // Determine if user has access
                let hasAccess = false;
                
                // Admin always has access
                if (currentUser.role === 'admin') {
                    hasAccess = true;
                } 
                // User needs proper privilege
                else if (currentUser.privileges && currentUser.privileges[key]) {
                    hasAccess = true;
                }
                
                // Get card text for logging
                const link = card.querySelector('a');
                const cardText = link ? link.textContent.trim() : 'Unknown';
                
                console.log(`Card "${cardText}": module=${module}, subUi=${subUi}, key=${key}, hasAccess=${hasAccess}`);
                
                // Apply access control
                if (!hasAccess) {
                    card.classList.add('disabled');
                    if (link) link.removeAttribute('href');
                    console.log(`  → DISABLED`);
                } else {
                    console.log(`  → ENABLED`);
                }
            } catch (cardError) {
                console.error("Error processing card:", cardError);
                // Don't disable on error, as it might be a false positive
            }
        });
    } catch (error) {
        console.error("Error in showMainUI:", error);
    }

    // Show/hide User Privilege button
    if (currentUser.role !== 'admin') {
        document.getElementById('userPrivilegeBtn').style.display = 'none';
    } else {
        document.getElementById('userPrivilegeBtn').style.display = 'inline-block';
    }
}


// Add this function to main.js
function updateLoggedInUserDisplay() {
    try {
        // Create or update the username display
        let userDisplayElem = document.getElementById('currentUserDisplay');
        
        if (!userDisplayElem) {
            // Create the element if it doesn't exist
            userDisplayElem = document.createElement('span');
            userDisplayElem.id = 'currentUserDisplay';
            userDisplayElem.className = 'badge bg-success me-2';
            
            // Insert it before the Active Users display
            const userStatusElem = document.getElementById('userStatus');
            if (userStatusElem && userStatusElem.parentNode) {
                userStatusElem.parentNode.insertBefore(userDisplayElem, userStatusElem);
            }
        }
        
        // Set the content
        if (currentUser && currentUser.username) {
            userDisplayElem.innerHTML = `<i class="fas fa-user"></i> ${currentUser.username}`;
        } else {
            userDisplayElem.innerHTML = `<i class="fas fa-user"></i> Guest`;
        }
    } catch (error) {
        console.error("Error updating user display:", error);
    }
}


    // Add this function to update the current user display
function updateLoggedInUserDisplay() {
    try {
        const userDisplayElem = document.getElementById('currentUserDisplay');
        if (userDisplayElem) {
            if (currentUser && currentUser.username) {
                const roleClass = currentUser.role === 'admin' ? 'text-danger' : 'text-white';
                userDisplayElem.innerHTML = `<i class="fas fa-user"></i> <span class="${roleClass}">${currentUser.username}</span>`;
            } else {
                userDisplayElem.innerHTML = `<i class="fas fa-user"></i> Guest`;
            }
        }
    } catch (error) {
        console.error("Error updating user display:", error);
    }
}


    // User Privilege Modal
         document.getElementById('userPrivilegeBtn').addEventListener('click', () => {
             fetch('/main/api/users', { credentials: 'include' })
                 .then(response => {
                     if (!response.ok) {
                         throw new Error(`HTTP error! status: ${response.status}`);
                     }
                     return response.json();
                 })
                 .then(users => {
                     const userSelect = document.getElementById('userSelect');
                     userSelect.innerHTML = '<option value="">Select a user</option>';
                     if (users.length === 0) {
                         console.log('No users with role "user" found.');
                     }
                     users.forEach(user => {
                         const option = document.createElement('option');
                         option.value = user.id;
                         option.textContent = user.username;
                         userSelect.appendChild(option);
                     });
                     userPrivilegeModal.show();
                 })
                 .catch(error => {
                     console.error('Error fetching users:', error);
                     alert(`Failed to load users: ${error.message}. Ensure you are logged in as admin.`);
                 });
         });

    // Load privileges when a user is selected
    // Replace your userSelect change event handler in main.js
document.getElementById('userSelect').addEventListener('change', (e) => {
    const userId = e.target.value;
    if (!userId) {
        document.getElementById('privilegesList').innerHTML = '';
        return;
    }

    console.log('Fetching privileges for user ID:', userId);
    
    // Show loading indicator
    const privilegesList = document.getElementById('privilegesList');
    privilegesList.innerHTML = '<div class="text-center"><div class="spinner-border text-primary" role="status"><span class="visually-hidden">Loading...</span></div><p>Loading privileges...</p></div>';

    fetch(`/main/api/user-privileges/${userId}`, { 
        credentials: 'include',
        headers: {
            'Cache-Control': 'no-cache'
        }
    })
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.json();
        })
        .then(privileges => {
            console.log('Received privileges from server:', privileges);
            
            privilegesList.innerHTML = '';

            // Handle empty privileges array
            if (!Array.isArray(privileges) || privileges.length === 0) {
                console.log('No privileges found for user');
                // Add a message for no privileges
                const noPrivsMessage = document.createElement('div');
                noPrivsMessage.className = 'alert alert-info';
                noPrivsMessage.textContent = 'No privileges assigned to this user yet.';
                privilegesList.appendChild(noPrivsMessage);
            }

            // Convert all privileges to lowercase and normalize for consistent comparison
            const normalizedPrivileges = Array.isArray(privileges) 
                ? privileges.map(p => ({
                    module: (p.module || '').toLowerCase().trim(),
                    sub_ui: (p.sub_ui || '').toLowerCase().trim()
                  }))
                : [];
            
            console.log('Normalized privileges:', normalizedPrivileges);

            // Define a helper function to check if privilege exists
            const hasPrivilege = (module, subUi) => {
                // Check different variations of the module/sub_ui combination
                return normalizedPrivileges.some(p => {
                    const pModule = p.module.replace('_module', '');
                    const modModule = module.replace('_module', '');
                    
                    const pSubUi = p.sub_ui.replace('module_', '');
                    const modSubUi = subUi.replace('module_', '');
                    
                    // Try different combinations
                    return (
                        // Exact match
                        (p.module === module && p.sub_ui === subUi) ||
                        // Without _module suffix in module
                        (pModule === modModule && p.sub_ui === subUi) ||
                        // Without module_ prefix in sub_ui
                        (p.module === module && pSubUi === modSubUi) ||
                        // Both modifications
                        (pModule === modModule && pSubUi === modSubUi)
                    );
                });
            };

            const allSubUIs = [
                { module: 'mis_module', sub_ui: 'orderfollowup_app', label: 'Order Follow Up' },
                { module: 'mis_module', sub_ui: 'floorposition_app', label: 'Floor Position Entry Form' },
                { module: 'mis_module', sub_ui: 'logreport_app', label: 'LOG Report' },
                { module: 'mis_module', sub_ui: 'mainplan_app', label: 'Main Plan' },
                { module: 'orderinformation_module', sub_ui: 'precosting_app', label: 'Pre-Costing Form' },
                { module: 'orderinformation_module', sub_ui: 'poentry_app', label: 'PO Entry Form' },
                { module: 'orderinformation_module', sub_ui: 'dispocreate_app', label: 'Dispo Create Form' },
                { module: 'yarn_module', sub_ui: 'greigeyarnreceive_app', label: 'Greige Yarn Receive Form' },
                { module: 'yarn_module', sub_ui: 'greigeyarnissue_app', label: 'Greige Yarn Issue Form' },
                { module: 'yarn_module', sub_ui: 'greigeyarnstock_app', label: 'Greige Yarn Stock Report' },
                { module: 'yarn_module', sub_ui: 'dyedyarnreceive_app', label: 'Dyed Yarn Receive Form' },
                { module: 'yarn_module', sub_ui: 'dyedyarnissue_app', label: 'Dyed Yarn Issue Form' },
                { module: 'yarn_module', sub_ui: 'dyedyarnstock_app', label: 'Dyed Yarn Stock Report' },
                { module: 'preparatory_module', sub_ui: 'warpingentry_app', label: 'Warping Entry Form' },
                { module: 'preparatory_module', sub_ui: 'sizingentry_app', label: 'Sizing Entry Form' },
                { module: 'loomproduction_module', sub_ui: 'loomproductionentry_app', label: 'Loom Production Entry Form' },
                { module: 'greigefabric_module', sub_ui: 'foldingproduction_app', label: 'Folding Production Entry Form' },
                { module: 'greigefabric_module', sub_ui: 'greigedelivery_app', label: 'Greige Delivery Form' },
                { module: 'greigefabric_module', sub_ui: 'greigefabricstock_app', label: 'Greige Fabric Stock' },
                { module: 'finishfabric_module', sub_ui: 'finishfabricreceive_app', label: 'Finish Fabric Receive Entry Form' },
                { module: 'finishfabric_module', sub_ui: 'finishfabricdelivery_app', label: 'Finish Fabric Delivery Entry Form' },
                { module: 'finishfabric_module', sub_ui: 'finishfabricstock_app', label: 'Finish Fabric Stock Report' },
            ];

            console.log('Checking against UI list:', allSubUIs.length, 'items');

            // Create a container for the checkboxes with a search filter
            const filterContainer = document.createElement('div');
            filterContainer.className = 'mb-3';
            filterContainer.innerHTML = `
                <input type="text" class="form-control" id="privilegeFilter" placeholder="Filter privileges...">
            `;
            privilegesList.appendChild(filterContainer);
            
            // Create container for privileges with max-height and scrolling
            const checkboxContainer = document.createElement('div');
            checkboxContainer.style.maxHeight = '350px';
            checkboxContainer.style.overflowY = 'auto';
            checkboxContainer.className = 'pb-2';
            privilegesList.appendChild(checkboxContainer);

            // Add select all checkbox
            const selectAllDiv = document.createElement('div');
            selectAllDiv.className = 'form-check mb-2 border-bottom pb-2';
            selectAllDiv.innerHTML = `
                <input class="form-check-input" type="checkbox" id="selectAllPrivileges">
                <label class="form-check-label fw-bold" for="selectAllPrivileges">Select All Privileges</label>
            `;
            checkboxContainer.appendChild(selectAllDiv);
            
            // Add privileges by module
            let currentModule = '';
            
            allSubUIs.forEach(item => {
                // Add module header if it's a new module
                if (item.module !== currentModule) {
                    currentModule = item.module;
                    const moduleHeader = document.createElement('div');
                    moduleHeader.className = 'fw-bold mt-3 mb-2 text-info';
                    moduleHeader.textContent = currentModule.toUpperCase().replace('_', ' ');
                    checkboxContainer.appendChild(moduleHeader);
                }
                
                // Use our helper function to check if this privilege exists
                const checked = hasPrivilege(item.module, item.sub_ui);
                
                console.log(`Item ${item.label}: module=${item.module}, sub_ui=${item.sub_ui}, checked=${checked}`);
                
                const div = document.createElement('div');
                div.className = 'form-check ms-4';
                div.setAttribute('data-filter-text', (item.label + ' ' + item.module).toLowerCase());
                div.innerHTML = `
                    <input class="form-check-input privilege-checkbox" type="checkbox" value="${item.module}_${item.sub_ui}" 
                           id="${item.module}_${item.sub_ui}" ${checked ? 'checked' : ''}>
                    <label class="form-check-label" for="${item.module}_${item.sub_ui}">${item.label}</label>
                `;
                checkboxContainer.appendChild(div);
            });
            
            // Add functionality to select all checkbox
            const selectAllCheckbox = document.getElementById('selectAllPrivileges');
            selectAllCheckbox.addEventListener('change', function() {
                const isChecked = this.checked;
                document.querySelectorAll('.privilege-checkbox').forEach(checkbox => {
                    checkbox.checked = isChecked;
                });
            });
            
            // Add functionality to filter
            const filterInput = document.getElementById('privilegeFilter');
            filterInput.addEventListener('input', function() {
                const filterText = this.value.toLowerCase();
                document.querySelectorAll('[data-filter-text]').forEach(div => {
                    const text = div.getAttribute('data-filter-text');
                    if (text.includes(filterText)) {
                        div.style.display = 'block';
                    } else {
                        div.style.display = 'none';
                    }
                });
            });
        })
        .catch(error => {
            console.error('Error fetching privileges:', error);
            privilegesList.innerHTML = `
                <div class="alert alert-danger">
                    <strong>Error:</strong> ${error.message}
                    <p>Please try again or contact support.</p>
                </div>
            `;
        });
});
    

    // Save privileges function
    // Replace the savePrivilegesBtn event handler in main.js
document.getElementById('savePrivilegesBtn').addEventListener('click', () => {
    const userId = document.getElementById('userSelect').value;
    if (!userId) {
        alert('Please select a user');
        return;
    }

    // Show loading state
    const saveBtn = document.getElementById('savePrivilegesBtn');
    const originalText = saveBtn.textContent;
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Saving...';

    // Get all checked privileges
    const selectedPrivileges = [];
    document.querySelectorAll('.privilege-checkbox:checked').forEach(input => {
        // Split by underscore but limit to 2 parts
        const parts = input.value.split('_');
        if (parts.length >= 2) {
            const module = parts[0];
            // Join the rest as sub_ui in case there are multiple underscores
            const sub_ui = parts.slice(1).join('_');
            
            selectedPrivileges.push({ 
                module: module.toLowerCase(), 
                sub_ui: sub_ui.toLowerCase() 
            });
        }
    });

    console.log('Selected privileges to save:', selectedPrivileges);

    // Create status message element
    const statusArea = document.createElement('div');
    statusArea.className = 'mt-3';
    statusArea.id = 'privilegeUpdateStatus';
    document.querySelector('.modal-body').appendChild(statusArea);
    
    statusArea.innerHTML = `
        <div class="alert alert-info">
            <span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
            Updating privileges for user ID: ${userId}. Please wait...
        </div>
    `;

    // Send the request
    fetch('/main/api/update-privileges', {
        method: 'POST',
        headers: { 
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache'
        },
        body: JSON.stringify({ 
            userId: userId, 
            privileges: selectedPrivileges 
        }),
        credentials: 'include'
    })
    .then(response => {
        console.log('Server response status:', response.status);
        
        // Try to parse JSON even if status is not OK
        return response.text().then(text => {
            try {
                return { 
                    ok: response.ok, 
                    status: response.status,
                    data: text ? JSON.parse(text) : {}
                };
            } catch (e) {
                console.warn("Failed to parse JSON response:", text);
                return { 
                    ok: response.ok, 
                    status: response.status,
                    text: text,
                    parseError: e.message
                };
            }
        });
    })
    .then(result => {
        if (!result.ok) {
            // Handle error response
            console.error('Server returned error:', result);
            
            let errorMsg = 'Failed to update privileges';
            if (result.data && result.data.error) {
                errorMsg += ': ' + result.data.error;
            }
            if (result.data && result.data.details) {
                errorMsg += '<br><small>' + result.data.details + '</small>';
            }
            
            // Show error in status area
            statusArea.innerHTML = `
                <div class="alert alert-danger">
                    <strong>Error:</strong> ${errorMsg}
                </div>
            `;
            
            throw new Error(`HTTP error! status: ${result.status}`);
        }
        
        // Handle successful response
        console.log('Update privileges success:', result.data);
        
        // Show success message
        statusArea.innerHTML = `
            <div class="alert alert-success">
                <i class="fas fa-check-circle"></i> Privileges updated successfully!
            </div>
        `;
        
        // Hide modal after delay
        setTimeout(() => {
            userPrivilegeModal.hide();
        }, 1500);
    })
    .catch(error => {
        console.error('Error updating privileges:', error);
        
        // Ensure status area shows error
        if (document.getElementById('privilegeUpdateStatus')) {
            document.getElementById('privilegeUpdateStatus').innerHTML = `
                <div class="alert alert-danger">
                    <strong>Error:</strong> ${error.message}
                </div>
            `;
        }
    })
    .finally(() => {
        // Restore button state
        saveBtn.disabled = false;
        saveBtn.innerHTML = originalText;
    });
});

// Custom Dropdown and RBAC Enhancement Functions
document.addEventListener('DOMContentLoaded', function() {
    // Custom Dropdown Logic
    const dropdownToggle = document.getElementById('userStatus');
    const dropdownMenu = document.getElementById('customDropdownMenu');
    
    if (dropdownToggle && dropdownMenu) {
        // Toggle the dropdown when the user status is clicked
        dropdownToggle.addEventListener('click', function(e) {
            e.stopPropagation(); // Prevent the event from bubbling up
            
            // Toggle the dropdown
            const isVisible = dropdownMenu.classList.contains('show');
            
            // Hide all existing dropdowns first
            const allDropdowns = document.querySelectorAll('.custom-dropdown-menu');
            allDropdowns.forEach(dropdown => {
                dropdown.classList.remove('show');
            });
            
            // Show or hide the dropdown
            if (!isVisible) {
                dropdownMenu.classList.add('show');
                
                // Position the dropdown correctly
                const toggleRect = dropdownToggle.getBoundingClientRect();
                dropdownMenu.style.top = (toggleRect.bottom + window.scrollY + 5) + 'px';
                dropdownMenu.style.left = (toggleRect.left + window.scrollX) + 'px';
                
                // Ensure the dropdown doesn't go beyond the right edge of the screen
                const menuWidth = dropdownMenu.offsetWidth;
                const viewportWidth = window.innerWidth;
                const menuRight = toggleRect.left + menuWidth;
                
                if (menuRight > viewportWidth) {
                    dropdownMenu.style.left = (viewportWidth - menuWidth - 10) + 'px';
                }
            }
        });
        
        // Close dropdown when clicking elsewhere
        document.addEventListener('click', function(e) {
            if (!dropdownToggle.contains(e.target) && !dropdownMenu.contains(e.target)) {
                dropdownMenu.classList.remove('show');
            }
        });
    }
    
    // Override the Bootstrap updateActiveUsers function to use our custom dropdown if it exists
    if (typeof updateActiveUsers === 'function') {
        const originalUpdateActiveUsers = updateActiveUsers;
        
        window.updateActiveUsers = function() {
            fetch('/main/api/active-users', { 
                credentials: 'include',
                headers: {
                    'Cache-Control': 'no-cache',
                    'Pragma': 'no-cache'
                }
            })
            .then(response => {
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                return response.json();
            })
            .then(data => {
                // Update counter
                const userStatusElem = document.getElementById('userStatus');
                if (userStatusElem) {
                    userStatusElem.innerHTML = `<i class="fas fa-users"></i> Active Users: ${data.count}`;
                }
                
                // Update active users list in our custom dropdown
                const usersListContainer = document.getElementById('activeUsersList');
                if (usersListContainer && data.users && data.users.length > 0) {
                    usersListContainer.innerHTML = '';
                    
                    data.users.forEach(user => {
                        const userItem = document.createElement('div');
                        userItem.className = 'active-user-item py-1 border-bottom';
                        
                        // Different styling for admin vs regular users
                        const badgeClass = user.role === 'admin' ? 'bg-danger' : 'bg-primary';
                        
                        userItem.innerHTML = `
                            <span class="badge ${badgeClass} me-1">
                                ${user.role}
                            </span>
                            ${user.username}
                        `;
                        usersListContainer.appendChild(userItem);
                    });
                } else if (usersListContainer) {
                    usersListContainer.innerHTML = '<div class="text-center text-muted">No active users</div>';
                }
            })
            .catch(error => {
                console.error('Error fetching active users:', error);
            });
        };
    }
});



});