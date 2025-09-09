console.log('Dashboard JavaScript loaded');

document.addEventListener('DOMContentLoaded', function() {
    console.log('DOM loaded, attaching event listeners');
    
    const clearSessionsBtn = document.getElementById('clearSessionsBtn');
    if (clearSessionsBtn) {
        console.log('Found clearSessionsBtn, attaching click listener');
        clearSessionsBtn.addEventListener('click', clearSessions);
    } else {
        console.error('clearSessionsBtn not found!');
    }

    const refreshClusterBtn = document.getElementById('refreshClusterBtn');
    if (refreshClusterBtn) {
        refreshClusterBtn.addEventListener('click', refreshClusterStatus);
    }

    // Load cluster status on page load
    refreshClusterStatus();

    // Auto-refresh cluster status every 60 seconds
    setInterval(refreshClusterStatus, 60000);
});

async function clearSessions(event) {
    console.log('clearSessions function called');
    if (!confirm('Are you sure you want to clear old (inactive/expired) sessions? This cannot be undone.')) {
        console.log('User cancelled confirmation');
        return;
    }
    console.log('User confirmed, proceeding with clear');
    
    const button = event.target.closest('button');
    const originalText = button.innerHTML;
    button.disabled = true;
    button.innerHTML = '<i class="bi bi-hourglass-split"></i> Clearing...';
    
    try {
        console.log('Making fetch request to /api/sessions/clear-inactive');
        const response = await fetch('/api/sessions/clear-inactive', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'same-origin'
        });
        
        console.log('Response status:', response.status);
        console.log('Response ok:', response.ok);
        
        if (!response.ok) {
            const text = await response.text();
            console.log('Response text:', text);
            alert('Server error: ' + response.status + ' - ' + text);
            return;
        }
        
        const result = await response.json();
        console.log('Response result:', result);
        
        if (result.success) {
            alert(`Successfully cleared ${result.count} old sessions.`);
            location.reload();
        } else {
            alert('Error clearing sessions: ' + result.error);
        }
    } catch (error) {
        console.error('Fetch error:', error);
        alert('Network error: ' + error.message);
    } finally {
        button.disabled = false;
        button.innerHTML = originalText;
    }
}

async function refreshClusterStatus() {
    const clusterStatusDiv = document.getElementById('clusterStatus');
    const isolationWarningDiv = document.getElementById('isolationWarning');
    const isolationMessage = document.getElementById('isolationMessage');

    if (!clusterStatusDiv) return;

    try {
        // Show loading spinner
        clusterStatusDiv.innerHTML = '<div class="text-center"><div class="spinner-border spinner-border-sm" role="status"></div></div>';

        const response = await fetch('/api/cluster/health', {
            credentials: 'same-origin'
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const result = await response.json();
        
        if (result.success) {
            displayClusterStatus(result.health);
            
            // Check for isolation warnings
            const warningResponse = await fetch('/api/cluster/isolation-warning', {
                credentials: 'same-origin'
            });
            
            if (warningResponse.ok) {
                const warningResult = await warningResponse.json();
                displayIsolationWarning(warningResult.warning);
            }
        } else {
            throw new Error(result.error || 'Unknown error');
        }
    } catch (error) {
        console.error('Error refreshing cluster status:', error);
        clusterStatusDiv.innerHTML = `
            <div class="text-danger small">
                <i class="bi bi-exclamation-triangle"></i>
                Error: ${error.message}
            </div>
        `;
    }
}

function displayClusterStatus(health) {
    const clusterStatusDiv = document.getElementById('clusterStatus');
    
    if (!health || !health.instances) {
        clusterStatusDiv.innerHTML = '<div class="text-muted small">No cluster data</div>';
        return;
    }

    const { instances, summary } = health;
    const healthyPercent = Math.round((summary.healthy / summary.total) * 100);
    
    let statusHtml = `
        <div class="d-flex justify-content-between align-items-center mb-2">
            <span class="badge bg-${summary.unhealthy === 0 ? 'success' : summary.healthy === 0 ? 'danger' : 'warning'}">
                ${summary.healthy}/${summary.total} Healthy
            </span>
            <small class="text-muted">${healthyPercent}%</small>
        </div>
    `;

    // Show instance details
    statusHtml += '<div class="small">';
    instances.forEach(instance => {
        const statusColor = instance.status === 'healthy' ? 'success' : 
                           instance.status === 'degraded' ? 'warning' : 'danger';
        const statusIcon = instance.status === 'healthy' ? 'check-circle' : 
                          instance.status === 'degraded' ? 'exclamation-triangle' : 'x-circle';
        
        statusHtml += `
            <div class="d-flex justify-content-between align-items-center mb-1">
                <span class="text-${statusColor}">
                    <i class="bi bi-${statusIcon}"></i> ${instance.name}
                </span>
                ${instance.responseTime ? `<span class="text-muted">${instance.responseTime}ms</span>` : ''}
            </div>
        `;
    });
    statusHtml += '</div>';

    clusterStatusDiv.innerHTML = statusHtml;
}

function displayIsolationWarning(warning) {
    const isolationWarningDiv = document.getElementById('isolationWarning');
    const isolationMessage = document.getElementById('isolationMessage');
    
    if (!isolationWarningDiv || !isolationMessage) return;

    if (warning) {
        isolationMessage.textContent = warning.message;
        isolationWarningDiv.style.display = 'block';
        
        // Store warning globally for form submissions
        window.clusterIsolationWarning = warning;
    } else {
        isolationWarningDiv.style.display = 'none';
        window.clusterIsolationWarning = null;
    }
}

// Global function to check for isolation before form submissions
window.checkClusterIsolationBeforeAction = function(actionName, confirmCallback) {
    if (!window.clusterIsolationWarning) {
        // No isolation - proceed normally
        return confirmCallback();
    }

    const warning = window.clusterIsolationWarning;
    const message = `⚠️ CLUSTER ISOLATION WARNING

${warning.message}

Isolated instances: ${warning.isolatedInstances.join(', ')}

Making changes during isolation may create conflicts when instances reconnect.

Recommendations:
${warning.recommendations.map(rec => '• ' + rec).join('\n')}

Do you want to proceed with "${actionName}" anyway?`;

    return confirm(message) && confirmCallback();
};