document.addEventListener('DOMContentLoaded', function() {
    console.log('Sessions JavaScript loaded');
    
    // Handle clear inactive sessions button
    document.querySelectorAll('[data-action="clear-inactive-sessions"]').forEach(button => {
        button.addEventListener('click', function(e) {
            clearInactiveSessions();
        });
    });
    
    // Handle clear all sessions button
    document.querySelectorAll('[data-action="clear-all-sessions"]').forEach(button => {
        button.addEventListener('click', function(e) {
            clearAllSessions();
        });
    });
    
    // Handle view session details buttons
    document.querySelectorAll('[data-action="view-session-details"]').forEach(button => {
        button.addEventListener('click', function(e) {
            const sessionId = this.dataset.sessionId;
            viewSessionDetails(sessionId);
        });
    });
    
    // Handle invalidate session buttons
    document.querySelectorAll('[data-action="invalidate-session"]').forEach(button => {
        button.addEventListener('click', function(e) {
            const sessionId = this.dataset.sessionId;
            invalidateSession(sessionId);
        });
    });
    
    // Handle delete session buttons
    document.querySelectorAll('[data-action="delete-session"]').forEach(button => {
        button.addEventListener('click', function(e) {
            const sessionId = this.dataset.sessionId;
            deleteSession(sessionId);
        });
    });
});

async function clearInactiveSessions() {
    if (!confirm('Are you sure you want to clear all inactive sessions?')) {
        return;
    }
    
    try {
        const response = await fetch('/admin/api/sessions/clear-inactive', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'same-origin'
        });
        
        const result = await response.json();
        
        if (result.success) {
            alert(`Successfully cleared ${result.count} inactive sessions.`);
            location.reload();
        } else {
            alert('Error: ' + result.error);
        }
    } catch (error) {
        alert('Network error: ' + error.message);
    }
}

async function clearAllSessions() {
    if (!confirm('Are you sure you want to clear ALL sessions? This will log out all users!')) {
        return;
    }
    
    try {
        const response = await fetch('/admin/api/sessions/clear-all', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'same-origin'
        });
        
        const result = await response.json();
        
        if (result.success) {
            alert(`Successfully cleared ${result.count} sessions.`);
            if (result.adminSessionCleared) {
                // Admin session was cleared, redirect to login
                window.location.href = '/admin/login';
            } else {
                location.reload();
            }
        } else {
            alert('Error: ' + result.error);
        }
    } catch (error) {
        alert('Network error: ' + error.message);
    }
}

async function viewSessionDetails(sessionId) {
    try {
        const response = await fetch(`/admin/api/sessions/${encodeURIComponent(sessionId)}`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'same-origin'
        });
        
        const result = await response.json();
        
        if (result.success) {
            const session = result.session;
            const content = `
                <div class="row">
                    <div class="col-md-6">
                        <dl class="row">
                            <dt class="col-sm-4">Session ID:</dt>
                            <dd class="col-sm-8"><code>${session.id}</code></dd>
                            
                            <dt class="col-sm-4">User:</dt>
                            <dd class="col-sm-8">
                                <strong>${session.user.username}</strong><br>
                                <small class="text-muted">${session.user.email}</small>
                            </dd>
                            
                            <dt class="col-sm-4">Client ID:</dt>
                            <dd class="col-sm-8"><code>${session.clientId}</code></dd>
                            
                            <dt class="col-sm-4">Status:</dt>
                            <dd class="col-sm-8">
                                ${session.active 
                                    ? (session.isExpired ? '<span class="badge bg-warning">Expired</span>' : '<span class="badge bg-success">Active</span>') 
                                    : '<span class="badge bg-secondary">Inactive</span>'
                                }
                            </dd>
                        </dl>
                    </div>
                    <div class="col-md-6">
                        <dl class="row">
                            <dt class="col-sm-5">Created:</dt>
                            <dd class="col-sm-7">${new Date(session.createdAt).toLocaleString()}</dd>
                            
                            <dt class="col-sm-5">Last Accessed:</dt>
                            <dd class="col-sm-7">${session.lastAccessedAt ? new Date(session.lastAccessedAt).toLocaleString() : 'Never'}</dd>
                            
                            <dt class="col-sm-5">Expires:</dt>
                            <dd class="col-sm-7">${session.expiresAt ? new Date(session.expiresAt).toLocaleString() : 'No expiry'}</dd>
                            
                            <dt class="col-sm-5">Tokens:</dt>
                            <dd class="col-sm-7">
                                ${session.accessToken ? '<span class="badge bg-success me-1">Access</span>' : ''}
                                ${session.refreshToken ? '<span class="badge bg-info me-1">Refresh</span>' : ''}
                                ${session.idToken ? '<span class="badge bg-primary me-1">ID</span>' : ''}
                            </dd>
                        </dl>
                    </div>
                </div>
                
                ${session.scopes && session.scopes.length > 0 ? `
                <hr>
                <h6>Scopes:</h6>
                ${session.scopes.map(scope => `<span class="badge bg-light text-dark me-1">${scope}</span>`).join('')}
                ` : ''}
            `;
            
            document.getElementById('sessionDetailsContent').innerHTML = content;
            const modal = new bootstrap.Modal(document.getElementById('sessionDetailsModal'));
            modal.show();
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
        const response = await fetch(`/admin/api/sessions/${encodeURIComponent(sessionId)}/invalidate`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'same-origin'
        });
        
        const result = await response.json();
        
        if (result.success) {
            alert('Session invalidated successfully.');
            location.reload();
        } else {
            alert('Error: ' + result.error);
        }
    } catch (error) {
        alert('Network error: ' + error.message);
    }
}

async function deleteSession(sessionId) {
    if (!confirm('Are you sure you want to delete this session? This cannot be undone.')) {
        return;
    }
    
    try {
        const response = await fetch(`/admin/api/sessions/${encodeURIComponent(sessionId)}`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'same-origin'
        });
        
        const result = await response.json();
        
        if (result.success) {
            alert('Session deleted successfully.');
            location.reload();
        } else {
            alert('Error: ' + result.error);
        }
    } catch (error) {
        alert('Network error: ' + error.message);
    }
}