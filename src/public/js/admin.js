// Admin interface JavaScript functions

// User management functions
function toggleUser(userId, enabled) {
    if (confirm(`Are you sure you want to ${enabled ? 'enable' : 'disable'} this user?`)) {
        fetch(`/admin/api/users/${userId}/toggle`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ enabled })
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                location.reload();
            } else {
                alert('Error: ' + data.error);
            }
        })
        .catch(error => {
            console.error('Error:', error);
            alert('An error occurred');
        });
    }
}

function deleteUser(userId) {
    if (confirm('Are you sure you want to delete this user? This action cannot be undone.')) {
        fetch(`/admin/api/users/${userId}`, {
            method: 'DELETE'
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                location.reload();
            } else {
                alert('Error: ' + data.error);
            }
        })
        .catch(error => {
            console.error('Error:', error);
            alert('An error occurred');
        });
    }
}

function resetPassword(userId) {
    const newPassword = prompt('Enter new password for user:');
    if (newPassword && newPassword.length >= 6) {
        fetch(`/admin/api/users/${userId}/password`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ password: newPassword })
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                alert('Password updated successfully');
            } else {
                alert('Error: ' + data.error);
            }
        })
        .catch(error => {
            console.error('Error:', error);
            alert('An error occurred');
        });
    } else if (newPassword !== null) {
        alert('Password must be at least 6 characters long');
    }
}

function showUserSessions(userId) {
    const modal = new bootstrap.Modal(document.getElementById('userSessionsModal'));
    const content = document.getElementById('userSessionsContent');
    
    content.innerHTML = '<div class="text-center py-3"><div class="spinner-border" role="status"></div></div>';
    modal.show();
    
    fetch(`/admin/api/users/${userId}/sessions`)
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                let html = '';
                if (data.sessions.length === 0) {
                    html = '<p class="text-muted text-center py-3">No sessions found</p>';
                } else {
                    html = '<div class="table-responsive"><table class="table table-sm">';
                    html += '<thead><tr><th>Client</th><th>Status</th><th>Created</th><th>Actions</th></tr></thead><tbody>';
                    data.sessions.forEach(session => {
                        const status = session.active ? (session.isExpired ? 'Expired' : 'Active') : 'Inactive';
                        const statusClass = session.active ? (session.isExpired ? 'warning' : 'success') : 'secondary';
                        html += `<tr>
                            <td><code>${session.clientId}</code></td>
                            <td><span class="badge bg-${statusClass}">${status}</span></td>
                            <td>${formatDate(session.createdAt)}</td>
                            <td>
                                ${session.active ? `<button class="btn btn-sm btn-outline-warning" onclick="invalidateSession('${session.id}')">Invalidate</button>` : ''}
                                <button class="btn btn-sm btn-outline-danger" onclick="deleteSession('${session.id}')">Delete</button>
                            </td>
                        </tr>`;
                    });
                    html += '</tbody></table></div>';
                }
                content.innerHTML = html;
            } else {
                content.innerHTML = '<div class="alert alert-danger">Error loading sessions</div>';
            }
        })
        .catch(error => {
            console.error('Error:', error);
            content.innerHTML = '<div class="alert alert-danger">Error loading sessions</div>';
        });
}

// Session management functions
function invalidateSession(sessionId) {
    if (confirm('Are you sure you want to invalidate this session?')) {
        fetch(`/admin/api/sessions/${sessionId}/invalidate`, {
            method: 'POST'
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                location.reload();
            } else {
                alert('Error: ' + data.error);
            }
        })
        .catch(error => {
            console.error('Error:', error);
            alert('An error occurred');
        });
    }
}

function deleteSession(sessionId) {
    if (confirm('Are you sure you want to delete this session?')) {
        fetch(`/admin/api/sessions/${sessionId}`, {
            method: 'DELETE'
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                location.reload();
            } else {
                alert('Error: ' + data.error);
            }
        })
        .catch(error => {
            console.error('Error:', error);
            alert('An error occurred');
        });
    }
}

function invalidateUserSessions(userId) {
    if (confirm('Are you sure you want to invalidate all sessions for this user?')) {
        fetch(`/admin/api/users/${userId}/sessions/invalidate`, {
            method: 'POST'
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                alert(`Invalidated ${data.count} sessions`);
                location.reload();
            } else {
                alert('Error: ' + data.error);
            }
        })
        .catch(error => {
            console.error('Error:', error);
            alert('An error occurred');
        });
    }
}

function clearInactiveSessions() {
    if (confirm('Are you sure you want to clear all inactive sessions?')) {
        fetch('/admin/api/sessions/clear-inactive', {
            method: 'POST'
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                alert(`Cleared ${data.count} inactive sessions`);
                location.reload();
            } else {
                alert('Error: ' + data.error);
            }
        })
        .catch(error => {
            console.error('Error:', error);
            alert('An error occurred');
        });
    }
}

function clearAllSessions() {
    if (confirm('Are you sure you want to clear ALL sessions? This will log out all users.')) {
        fetch('/admin/api/sessions/clear-all', {
            method: 'POST'
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                alert(`Cleared ${data.count} sessions`);
                location.reload();
            } else {
                alert('Error: ' + data.error);
            }
        })
        .catch(error => {
            console.error('Error:', error);
            alert('An error occurred');
        });
    }
}

function clearSessions() {
    clearInactiveSessions();
}

function viewSessionDetails(sessionId) {
    const modal = new bootstrap.Modal(document.getElementById('sessionDetailsModal'));
    const content = document.getElementById('sessionDetailsContent');
    
    content.innerHTML = '<div class="text-center py-3"><div class="spinner-border" role="status"></div></div>';
    modal.show();
    
    fetch(`/admin/api/sessions/${sessionId}`)
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                const session = data.session;
                const html = `
                    <dl class="row">
                        <dt class="col-sm-3">Session ID:</dt>
                        <dd class="col-sm-9"><code>${session.id}</code></dd>
                        
                        <dt class="col-sm-3">User:</dt>
                        <dd class="col-sm-9">${session.user.username} (${session.user.email})</dd>
                        
                        <dt class="col-sm-3">Client ID:</dt>
                        <dd class="col-sm-9"><code>${session.clientId}</code></dd>
                        
                        <dt class="col-sm-3">Scopes:</dt>
                        <dd class="col-sm-9">
                            ${session.scopes.map(s => `<span class="badge bg-light text-dark me-1">${s}</span>`).join('')}
                        </dd>
                        
                        <dt class="col-sm-3">Status:</dt>
                        <dd class="col-sm-9">
                            <span class="badge bg-${session.active ? (session.isExpired ? 'warning' : 'success') : 'secondary'}">
                                ${session.active ? (session.isExpired ? 'Expired' : 'Active') : 'Inactive'}
                            </span>
                        </dd>
                        
                        <dt class="col-sm-3">Created:</dt>
                        <dd class="col-sm-9">${formatDate(session.createdAt)}</dd>
                        
                        <dt class="col-sm-3">Last Accessed:</dt>
                        <dd class="col-sm-9">${session.lastAccessedAt ? formatDate(session.lastAccessedAt) : 'Never'}</dd>
                        
                        <dt class="col-sm-3">Expires:</dt>
                        <dd class="col-sm-9">${session.expiresAt ? formatDate(session.expiresAt) : 'No expiry'}</dd>
                        
                        <dt class="col-sm-3">Has Tokens:</dt>
                        <dd class="col-sm-9">
                            ${session.accessToken ? '<span class="badge bg-success me-1">Access</span>' : ''}
                            ${session.refreshToken ? '<span class="badge bg-info me-1">Refresh</span>' : ''}
                            ${session.idToken ? '<span class="badge bg-primary me-1">ID</span>' : ''}
                        </dd>
                    </dl>
                `;
                content.innerHTML = html;
            } else {
                content.innerHTML = '<div class="alert alert-danger">Error loading session details</div>';
            }
        })
        .catch(error => {
            console.error('Error:', error);
            content.innerHTML = '<div class="alert alert-danger">Error loading session details</div>';
        });
}

// Utility functions
function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleString();
}

// Initialize page
document.addEventListener('DOMContentLoaded', function() {
    // Auto-hide alerts after 5 seconds
    const alerts = document.querySelectorAll('.alert:not(.alert-permanent)');
    alerts.forEach(alert => {
        setTimeout(() => {
            const bsAlert = new bootstrap.Alert(alert);
            bsAlert.close();
        }, 5000);
    });
});