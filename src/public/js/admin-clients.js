document.addEventListener('DOMContentLoaded', function() {
    console.log('Clients page JavaScript loaded');
    
    // Handle toggle client buttons
    document.querySelectorAll('[data-action="toggle-client"]').forEach(button => {
        button.addEventListener('click', function(e) {
            const clientId = this.dataset.clientId;
            const enabled = this.dataset.enabled === 'true';
            toggleClient(clientId, enabled);
        });
    });
    
    // Handle regenerate secret buttons
    document.querySelectorAll('[data-action="regenerate-secret"]').forEach(button => {
        button.addEventListener('click', function(e) {
            const clientId = this.dataset.clientId;
            regenerateClientSecret(clientId);
        });
    });
    
    // Handle delete client buttons
    document.querySelectorAll('[data-action="delete-client"]').forEach(button => {
        button.addEventListener('click', function(e) {
            const clientId = this.dataset.clientId;
            deleteClient(clientId);
        });
    });
});

async function toggleClient(clientId, enabled) {
    const action = enabled ? 'enable' : 'disable';
    if (!confirm(`Are you sure you want to ${action} this client?`)) {
        return;
    }
    
    try {
        const response = await fetch(`/admin/api/clients/${encodeURIComponent(clientId)}/toggle`, {
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

async function regenerateClientSecret(clientId) {
    if (!confirm('Are you sure you want to regenerate the client secret? The old secret will stop working immediately.')) {
        return;
    }
    
    try {
        const response = await fetch(`/admin/api/clients/${encodeURIComponent(clientId)}/regenerate-secret`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'same-origin'
        });
        
        const result = await response.json();
        
        if (result.success) {
            alert(`New client secret: ${result.clientSecret}\n\nPlease save this secret now - it will not be shown again!`);
            location.reload();
        } else {
            alert('Error: ' + result.error);
        }
    } catch (error) {
        alert('Network error: ' + error.message);
    }
}

async function deleteClient(clientId) {
    if (!confirm('Are you sure you want to delete this client? This cannot be undone and will break any applications using this client.')) {
        return;
    }
    
    try {
        const response = await fetch(`/admin/api/clients/${encodeURIComponent(clientId)}`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'same-origin'
        });
        
        const result = await response.json();
        
        if (result.success) {
            window.location.href = '/admin/clients?message=Client deleted successfully&messageType=success';
        } else {
            alert('Error: ' + result.error);
        }
    } catch (error) {
        alert('Network error: ' + error.message);
    }
}