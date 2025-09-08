document.addEventListener('DOMContentLoaded', function() {
    console.log('Users page JavaScript loaded');
    
    // Handle sessions buttons
    document.querySelectorAll('[data-action="show-sessions"]').forEach(button => {
        button.addEventListener('click', function(e) {
            const userId = this.dataset.userId;
            showUserSessions(userId);
        });
    });
    
    // Handle toggle user buttons
    document.querySelectorAll('[data-action="toggle-user"]').forEach(button => {
        button.addEventListener('click', function(e) {
            const userId = this.dataset.userId;
            const enabled = this.dataset.enabled === 'true';
            toggleUser(userId, enabled);
        });
    });
    
    // Handle delete user buttons
    document.querySelectorAll('[data-action="delete-user"]').forEach(button => {
        button.addEventListener('click', function(e) {
            const userId = this.dataset.userId;
            deleteUser(userId);
        });
    });
    
    // Handle invalidate session buttons in modal (dynamically created)
    document.addEventListener('click', function(e) {
        if (e.target.matches('[data-action="invalidate-session"]')) {
            const sessionId = e.target.dataset.sessionId;
            invalidateSessionFromModal(sessionId);
        }
    });
});

async function showUserSessions(userId) {
    const modal = new bootstrap.Modal(document.getElementById('userSessionsModal'));
    const content = document.getElementById('userSessionsContent');
    
    // Reset content to loading state
    content.innerHTML = `
        <div class="text-center py-3">
            <div class="spinner-border" role="status"></div>
            <div class="mt-2">Loading sessions...</div>
        </div>
    `;
    
    modal.show();
    
    try {
        const response = await fetch(`/admin/api/users/${encodeURIComponent(userId)}/sessions`, {
            credentials: 'same-origin'
        });
        const result = await response.json();
        
        if (result.success) {
            if (result.sessions.length === 0) {
                content.innerHTML = '<p class="text-center text-muted py-3">No sessions found for this user.</p>';
            } else {
                let html = '<div class="list-group">';
                result.sessions.forEach(session => {
                    const statusBadge = session.active 
                        ? (session.isExpired ? '<span class="badge bg-warning">Expired</span>' : '<span class="badge bg-success">Active</span>')
                        : '<span class="badge bg-secondary">Inactive</span>';
                    
                    html += `
                        <div class="list-group-item">
                            <div class="d-flex justify-content-between align-items-start">
                                <div class="small">
                                    <div><strong>Client:</strong> ${session.clientId}</div>
                                    <div class="text-muted">Created: ${new Date(session.createdAt).toLocaleString()}</div>
                                    ${session.expiresAt ? `<div class="text-muted">Expires: ${new Date(session.expiresAt).toLocaleString()}</div>` : ''}
                                </div>
                                <div>
                                    ${statusBadge}
                                </div>
                            </div>
                            ${session.active ? `
                                <div class="mt-2">
                                    <button class="btn btn-sm btn-outline-danger" data-action="invalidate-session" data-session-id="${session.id}">
                                        <i class="bi bi-x-circle"></i> Invalidate
                                    </button>
                                </div>
                            ` : ''}
                        </div>
                    `;
                });
                html += '</div>';
                content.innerHTML = html;
            }
        } else {
            content.innerHTML = `<div class="alert alert-danger">Error: ${result.error}</div>`;
        }
    } catch (error) {
        content.innerHTML = `<div class="alert alert-danger">Network error: ${error.message}</div>`;
    }
}

async function toggleUser(userId, enabled) {
    const action = enabled ? 'enable' : 'disable';
    
    // Check for cluster isolation before proceeding
    const proceedWithAction = () => {
        return confirm(`Are you sure you want to ${action} this user?`);
    };
    
    if (typeof window.checkClusterIsolationBeforeAction === 'function') {
        if (!window.checkClusterIsolationBeforeAction(`${action} user`, proceedWithAction)) {
            return;
        }
    } else if (!proceedWithAction()) {
        return;
    }
    
    try {
        const response = await fetch(`/admin/api/users/${encodeURIComponent(userId)}/toggle`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'same-origin',
            body: JSON.stringify({ enabled })
        });
        
        const result = await response.json();
        
        if (result.success) {
            location.reload();
        } else {
            alert('Error: ' + result.error);
        }
    } catch (error) {
        alert('Network error: ' + error.message);
    }
}

async function deleteUser(userId) {
    // Check for cluster isolation before proceeding
    const proceedWithAction = () => {
        return confirm('Are you sure you want to delete this user? This cannot be undone.');
    };
    
    if (typeof window.checkClusterIsolationBeforeAction === 'function') {
        if (!window.checkClusterIsolationBeforeAction('delete user', proceedWithAction)) {
            return;
        }
    } else if (!proceedWithAction()) {
        return;
    }
    
    try {
        const response = await fetch(`/admin/api/users/${encodeURIComponent(userId)}`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'same-origin'
        });
        
        const result = await response.json();
        
        if (result.success) {
            location.reload();
        } else {
            alert('Error: ' + result.error);
        }
    } catch (error) {
        alert('Network error: ' + error.message);
    }
}

async function invalidateSessionFromModal(sessionId) {
    if (!confirm('Are you sure you want to invalidate this session?')) {
        return;
    }
    
    try {
        const response = await fetch(`/admin/api/sessions/${encodeURIComponent(sessionId)}/invalidate`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'same-origin'
        });
        
        const result = await response.json();
        
        if (result.success) {
            // Refresh the modal content by finding the first user button and getting its userId
            const userButton = document.querySelector('[data-action="show-sessions"]');
            if (userButton) {
                showUserSessions(userButton.dataset.userId);
            }
        } else {
            alert('Error: ' + result.error);
        }
    } catch (error) {
        alert('Network error: ' + error.message);
    }
}