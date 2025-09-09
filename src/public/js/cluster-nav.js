// Navigation bar cluster status monitoring
let clusterStatusInterval;
let isolationWarning = null;

document.addEventListener('DOMContentLoaded', function() {
    initializeClusterNavStatus();
    startClusterNavMonitoring();
});

function initializeClusterNavStatus() {
    updateClusterNavStatus();
    
    // Add click handler for cluster status (optional - show details)
    const clusterStatus = document.getElementById('navClusterStatus');
    if (clusterStatus) {
        clusterStatus.style.cursor = 'pointer';
        clusterStatus.setAttribute('title', 'Click to view detailed cluster information');
        clusterStatus.addEventListener('click', showClusterDetails);
    }
}

function startClusterNavMonitoring() {
    // Update cluster status every 30 seconds
    clusterStatusInterval = setInterval(updateClusterNavStatus, 30000);
}

async function updateClusterNavStatus() {
    const spinner = document.getElementById('clusterStatusSpinner');
    const content = document.getElementById('clusterStatusContent');
    const spinnerDesktop = document.getElementById('clusterStatusSpinnerDesktop');
    const contentDesktop = document.getElementById('clusterStatusContentDesktop');
    
    // We need at least one content element to work with
    if (!content && !contentDesktop) return;
    
    try {
        // Show spinner briefly on both versions if they exist
        if (spinner) spinner.style.display = 'block';
        if (spinnerDesktop) spinnerDesktop.style.display = 'block';
        
        const response = await fetch('/api/cluster/health', {
            credentials: 'same-origin'
        });
        
        if (response.status === 401) {
            // Authentication required - show message and reload page
            const authResult = await response.json();
            showAuthenticationPrompt(authResult.message || 'Please refresh the page to re-authenticate');
            return;
        }
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        const result = await response.json();
        
        if (result.success) {
            // Update both mobile and desktop versions if they exist
            if (content) displayClusterNavStatus(result.health, content);
            if (contentDesktop) displayClusterNavStatus(result.health, contentDesktop);
            
            // Check for isolation warnings
            const warningResponse = await fetch('/api/cluster/isolation-warning', {
                credentials: 'same-origin'
            });
            
            if (warningResponse.status === 401) {
                // Skip isolation warning if not authenticated
                return;
            }
            
            if (warningResponse.ok) {
                const warningResult = await warningResponse.json();
                isolationWarning = warningResult.warning;
                updateGlobalIsolationWarning(warningResult.warning);
            }
        } else {
            throw new Error(result.error || 'Unknown error');
        }
    } catch (error) {
        console.error('Error updating cluster nav status:', error);
        const errorHtml = `
            <small class="text-danger">
                <i class="bi bi-exclamation-triangle"></i> Cluster Error
            </small>
        `;
        if (content) content.innerHTML = errorHtml;
        if (contentDesktop) contentDesktop.innerHTML = errorHtml;
    } finally {
        // Hide spinner on both versions if they exist
        if (spinner) spinner.style.display = 'none';
        if (spinnerDesktop) spinnerDesktop.style.display = 'none';
    }
}

function displayClusterNavStatus(health, contentElement) {
    if (!contentElement) return;
    
    if (!health || !health.instances) {
        contentElement.innerHTML = '<small class="text-muted">No cluster data</small>';
        return;
    }
    
    const { instances, summary } = health;
    const healthyPercent = Math.round((summary.healthy / summary.total) * 100);
    
    // Remove response time calculation for performance
    
    // Determine status color and icon
    let statusColor, statusIcon;
    if (summary.unhealthy === 0) {
        statusColor = 'success';
        statusIcon = 'check-circle-fill';
    } else if (summary.healthy === 0) {
        statusColor = 'danger';
        statusIcon = 'x-circle-fill';
    } else {
        statusColor = 'warning';
        statusIcon = 'exclamation-triangle-fill';
    }
    
    // Calculate cluster uptime or downtime
    let timeLabel = 'Uptime';
    let timeValue = 'Unknown';
    
    if (summary.unhealthy === 0) {
        // All nodes healthy - show uptime
        if (health.clusterUptime && health.clusterUptime.fullySyncedSince && health.clusterUptime.uptimeMs > 0) {
            const uptimeSeconds = Math.floor(health.clusterUptime.uptimeMs / 1000);
            timeValue = formatDuration(uptimeSeconds);
        }
    } else {
        // Some nodes down - show downtime using isolation timestamp
        timeLabel = 'Downtime';
        if (health.isolationInfo && health.isolationInfo.isolated && health.isolationInfo.since) {
            const isolatedSince = new Date(health.isolationInfo.since);
            const downtimeMs = new Date() - isolatedSince;
            const downtimeSeconds = Math.floor(downtimeMs / 1000);
            timeValue = formatDuration(downtimeSeconds);
        }
    }
    
    function formatDuration(seconds) {
        const days = Math.floor(seconds / 86400);
        const hours = Math.floor((seconds % 86400) / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;
        
        const parts = [];
        if (days > 0) parts.push(`${days}d`);
        if (hours > 0) parts.push(`${hours}h`);
        if (minutes > 0) parts.push(`${minutes}m`);
        if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);
        
        return parts.join(' ');
    }
    
    contentElement.innerHTML = `
        <div class="cluster-status-container">
            <span class="text-${statusColor} cluster-status-basic" style="line-height: 1; display: inline-flex; align-items: center;">
                <i class="bi bi-${statusIcon}" style="font-size: 1rem;"></i>
                <span class="fw-bold ms-1" style="font-size: 0.8rem;">${summary.healthy}/${summary.total} nodes</span>
            </span>
            <div class="cluster-status-details position-absolute bg-dark border rounded p-2 shadow-sm" style="display: none; top: 100%; right: 0; white-space: nowrap; z-index: 1000;">
                <div class="text-light" style="font-size: 0.75rem;">
                    <div><strong>${timeLabel}:</strong> ${timeValue}</div>
                </div>
            </div>
        </div>
    `;
    
    // Add hover event listeners
    const container = contentElement.querySelector('.cluster-status-container');
    const basic = container.querySelector('.cluster-status-basic');
    const details = container.querySelector('.cluster-status-details');
    
    basic.addEventListener('mouseenter', function() {
        details.style.display = 'block';
    });
    
    container.addEventListener('mouseleave', function() {
        details.style.display = 'none';
    });
}

function updateGlobalIsolationWarning(warning) {
    // Update the global isolation warning state for other scripts
    window.clusterIsolationWarning = warning;
}

function showClusterDetails() {
    // Optional: Show a modal or navigate to cluster details
    // For now, just navigate to dashboard where detailed cluster info is shown
    if (window.location.pathname !== '/' && window.location.pathname !== '') {
        window.location.href = '/#cluster-status';
    }
}

function showAuthenticationPrompt(message) {
    // Show a user-friendly authentication prompt
    const authHtml = `
        <div class="alert alert-warning alert-dismissible fade show position-fixed" 
             style="top: 20px; right: 20px; z-index: 9999; min-width: 300px;" role="alert">
            <i class="bi bi-shield-lock"></i> <strong>Authentication Required</strong><br>
            ${message}
            <br><br>
            <button class="btn btn-sm btn-primary" onclick="window.location.reload()">
                <i class="bi bi-arrow-clockwise"></i> Refresh Page
            </button>
            <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
        </div>
    `;
    
    // Add to body if it doesn't already exist
    const existingAlert = document.querySelector('.auth-alert');
    if (!existingAlert) {
        const alertDiv = document.createElement('div');
        alertDiv.className = 'auth-alert';
        alertDiv.innerHTML = authHtml;
        document.body.appendChild(alertDiv);
        
        // Auto-hide after 10 seconds
        setTimeout(() => {
            const alert = document.querySelector('.auth-alert');
            if (alert) alert.remove();
        }, 10000);
    }
}

// Clean up interval when page unloads
window.addEventListener('beforeunload', function() {
    if (clusterStatusInterval) {
        clearInterval(clusterStatusInterval);
    }
});