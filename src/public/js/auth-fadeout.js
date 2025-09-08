document.addEventListener('DOMContentLoaded', function() {
    const authRequest = document.getElementById('authRequest');
    if (authRequest) {
        // Calculate reading time: ~200 words per minute, ~4 words per second
        const text = authRequest.textContent || '';
        const wordCount = text.trim().split(/\s+/).length;
        const readingTimeMs = Math.max(5000, wordCount * 300); // Minimum 5 seconds, 300ms per word
        
        // Add a slight delay before starting the fade out
        setTimeout(function() {
            authRequest.classList.add('fade-out');
            
            // Remove the element from the DOM after the animation completes
            setTimeout(function() {
                authRequest.style.display = 'none';
            }, 500); // Match the CSS transition duration
        }, readingTimeMs);
    }
});