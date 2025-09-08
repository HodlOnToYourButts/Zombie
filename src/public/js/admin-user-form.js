document.addEventListener('DOMContentLoaded', function() {
    console.log('User form JavaScript loaded');
    
    // Handle reset password buttons
    document.querySelectorAll('[data-action="reset-password"]').forEach(button => {
        button.addEventListener('click', function(e) {
            const userId = this.dataset.userId;
            resetPassword(userId);
        });
    });
    
    // Handle show user sessions buttons
    document.querySelectorAll('[data-action="show-user-sessions"]').forEach(button => {
        button.addEventListener('click', function(e) {
            const userId = this.dataset.userId;
            showUserSessions(userId);
        });
    });
    
    // Handle invalidate user sessions buttons
    document.querySelectorAll('[data-action="invalidate-user-sessions"]').forEach(button => {
        button.addEventListener('click', function(e) {
            const userId = this.dataset.userId;
            invalidateUserSessions(userId);
        });
    });
    
    // Handle delete user buttons
    document.querySelectorAll('[data-action="delete-user"]').forEach(button => {
        button.addEventListener('click', function(e) {
            const userId = this.dataset.userId;
            deleteUser(userId);
        });
    });
});

async function resetPassword(userId) {
    const newPassword = prompt('Enter new password (minimum 6 characters):');
    if (!newPassword) return;
    
    if (newPassword.length < 6) {
        alert('Password must be at least 6 characters long.');
        return;
    }
    
    try {
        const response = await fetch(`/admin/api/users/${encodeURIComponent(userId)}/password`, {
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

async function showUserSessions(userId) {
    // For now, redirect to user details page which shows sessions
    window.location.href = `/admin/users/${encodeURIComponent(userId)}`;
}

async function invalidateUserSessions(userId) {
    if (!confirm('Are you sure you want to invalidate all sessions for this user?')) {
        return;
    }
    
    try {
        const response = await fetch(`/admin/api/users/${encodeURIComponent(userId)}/sessions/invalidate`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'same-origin'
        });
        
        const result = await response.json();
        
        if (result.success) {
            alert(`Successfully invalidated ${result.count} sessions.`);
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
        const response = await fetch(`/admin/api/users/${encodeURIComponent(userId)}`, {
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