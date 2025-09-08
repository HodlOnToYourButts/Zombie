document.addEventListener('DOMContentLoaded', function() {
    console.log('Client form JavaScript loaded');
    
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
    
    // Handle toggle client buttons
    document.querySelectorAll('[data-action="toggle-client"]').forEach(button => {
        button.addEventListener('click', function(e) {
            const clientId = this.dataset.clientId;
            const enabled = this.dataset.enabled === 'true';
            toggleClient(clientId, enabled);
        });
    });
    
    // Handle toggle secret buttons
    document.querySelectorAll('[data-action="toggle-secret"]').forEach(button => {
        button.addEventListener('click', function(e) {
            toggleSecret();
        });
    });
    
    // Handle copy text buttons
    document.querySelectorAll('[data-action="copy-text"]').forEach(button => {
        button.addEventListener('click', function(e) {
            const text = this.dataset.text;
            copyToClipboard(text, this);
        });
    });
});

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
            // Update the displayed secret
            document.getElementById('clientSecret').textContent = result.clientSecret;
            document.getElementById('maskedSecret').textContent = '••••••••' + result.clientSecret.slice(-4);
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

function toggleSecret() {
    const secret = document.getElementById('clientSecret');
    const masked = document.getElementById('maskedSecret');
    const copyBtn = document.getElementById('copySecretBtn');
    const toggleBtn = document.querySelector('[data-action="toggle-secret"]');
    const toggleIcon = document.getElementById('toggleIcon');
    
    if (!secret || !masked || !toggleBtn) {
        console.error('Required elements not found for toggleSecret');
        return;
    }
    
    if (secret.style.display === 'none') {
        secret.style.display = 'inline';
        masked.style.display = 'none';
        
        // Handle client-details page layout (with text buttons)
        if (toggleBtn.innerHTML.includes('Show') || toggleBtn.innerHTML.includes('Hide')) {
            toggleBtn.innerHTML = '<i class="bi bi-eye-slash"></i> Hide';
        }
        // Handle client-form page layout (with icon only)
        if (toggleIcon) {
            toggleIcon.className = 'bi bi-eye-slash';
        }
        
        if (copyBtn) {
            copyBtn.style.display = 'inline-block';
        }
    } else {
        secret.style.display = 'none';
        masked.style.display = 'inline';
        
        // Handle client-details page layout (with text buttons)
        if (toggleBtn.innerHTML.includes('Show') || toggleBtn.innerHTML.includes('Hide')) {
            toggleBtn.innerHTML = '<i class="bi bi-eye"></i> Show';
        }
        // Handle client-form page layout (with icon only)
        if (toggleIcon) {
            toggleIcon.className = 'bi bi-eye';
        }
        
        if (copyBtn) {
            copyBtn.style.display = 'none';
        }
    }
}

function copyToClipboard(text, buttonElement) {
    navigator.clipboard.writeText(text).then(function() {
        // Show temporary success feedback
        const originalHTML = buttonElement.innerHTML;
        buttonElement.innerHTML = '<i class="bi bi-check"></i>';
        setTimeout(() => {
            buttonElement.innerHTML = originalHTML;
        }, 1000);
    }).catch(function(err) {
        console.error('Could not copy text: ', err);
        alert('Failed to copy to clipboard');
    });
}