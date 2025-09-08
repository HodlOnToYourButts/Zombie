document.addEventListener('DOMContentLoaded', function() {
    console.log('User details JavaScript loaded');
    
    // Handle all buttons with data-action attributes
    document.addEventListener('click', function(e) {
        const action = e.target.closest('[data-action]')?.dataset.action;
        if (!action) return;
        
        const userId = e.target.closest('[data-user-id]')?.dataset.userId;
        const sessionId = e.target.closest('[data-session-id]')?.dataset.sessionId;
        const enabled = e.target.closest('[data-enabled]')?.dataset.enabled === 'true';
        
        switch(action) {
            case 'toggle-user':
                toggleUser(userId, enabled);
                break;
            case 'reset-password':
                resetPassword(userId);
                break;
            case 'delete-user':
                deleteUser(userId);
                break;
            case 'invalidate-session':
                invalidateSession(sessionId);
                break;
            case 'show-all-sessions':
                showAllSessions(userId);
                break;
        }
    });
});

async function toggleUser(userId, enabled) {
    const action = enabled ? 'enable' : 'disable';
    if (!confirm(`Are you sure you want to ${action} this user?`)) {
        return;
    }
    
    try {
        const response = await fetch(`/admin/api/users/${userId}/toggle`, {
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
    if (!confirm('Are you sure you want to delete this user? This cannot be undone.')) {
        return;
    }
    
    try {
        const response = await fetch(`/admin/api/users/${userId}`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'same-origin'
        });
        
        const result = await response.json();
        
        if (result.success) {
            window.location.href = '/admin/users?message=User deleted successfully&messageType=success';
        } else {
            alert('Error: ' + result.error);
        }
    } catch (error) {
        alert('Network error: ' + error.message);
    }
}

async function resetPassword(userId) {
    const newPassword = prompt('Enter new password (minimum 6 characters):');
    if (!newPassword) return;
    
    if (newPassword.length < 6) {
        alert('Password must be at least 6 characters long.');
        return;
    }
    
    try {
        const response = await fetch(`/admin/api/users/${userId}/password`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'same-origin',
            body: JSON.stringify({ password: newPassword })
        });
        
        const result = await response.json();
        
        if (result.success) {
            alert('Password reset successfully.');
        } else {
            alert('Error: ' + result.error);
        }
    } catch (error) {
        alert('Network error: ' + error.message);
    }
}

async function invalidateSession(sessionId) {
    if (!confirm('Are you sure you want to invalidate this session?')) {
        return;
    }
    
    try {
        const response = await fetch(`/admin/api/sessions/${sessionId}/invalidate`, {
            method: 'POST',
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

async function showAllSessions(userId) {
    try {
        const response = await fetch(`/admin/api/users/${userId}/sessions`);
        const result = await response.json();
        
        if (result.success) {
            displayUserSessions(result.sessions);
        } else {
            alert('Error loading sessions: ' + result.error);
        }
    } catch (error) {
        alert('Network error: ' + error.message);
    }
}

function displayUserSessions(sessions) {
    let content = '';
    
    if (sessions.length === 0) {
        content = '<p class="text-muted">No sessions found for this user.</p>';
    } else {
        content = '<div class="table-responsive"><table class="table table-sm">';
        content += '<thead><tr><th>Client</th><th>Created</th><th>Status</th><th>Actions</th></tr></thead><tbody>';
        
        sessions.forEach(session => {
            const statusBadge = session.active && !session.isExpired 
                ? '<span class="badge bg-success">Active</span>'
                : session.active 
                    ? '<span class="badge bg-warning">Expired</span>'
                    : '<span class="badge bg-secondary">Inactive</span>';
            
            const actions = session.active && !session.isExpired
                ? `<button class="btn btn-sm btn-outline-danger" data-action="invalidate-session" data-session-id="${session.id}">
                     <i class="bi bi-x-circle"></i> Invalidate
                   </button>`
                : '';
            
            content += `<tr>
                <td>${session.clientId || 'Unknown'}</td>
                <td class="small text-muted">${new Date(session.createdAt).toLocaleString()}</td>
                <td>${statusBadge}</td>
                <td>${actions}</td>
            </tr>`;
        });
        
        content += '</tbody></table></div>';
    }
    
    // Create or update modal
    let modal = document.getElementById('allSessionsModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.className = 'modal fade';
        modal.id = 'allSessionsModal';
        modal.innerHTML = `
            <div class="modal-dialog modal-lg">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">All User Sessions</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body" id="allSessionsContent"></div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }
    
    document.getElementById('allSessionsContent').innerHTML = content;
    
    // Show modal
    const bootstrapModal = new bootstrap.Modal(modal);
    bootstrapModal.show();
}