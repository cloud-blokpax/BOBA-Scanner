// api-utils.js

/**
 * Fetch with retry functionality.
 * @param {string} url - The URL to fetch.
 * @param {Object} options - Fetch options.
 * @param {number} retries - Number of retries.
 * @param {number} timeout - Timeout in milliseconds.
 * @returns {Promise<Response>} - The response from the fetch.
 */
async function fetchWithRetry(url, options = {}, retries = 3, timeout = 5000) {
    const controller = new AbortController();
    const { signal } = controller;

    const fetchPromise = fetch(url, { ...options, signal });
    const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => { controller.abort(); reject(new Error('Request timed out')); }, timeout)
    );

    try {
        const response = await Promise.race([fetchPromise, timeoutPromise]);
        if (!response.ok) {
            throw new Error('Network response was not ok');
        }
        return response;
    } catch (error) {
        if (retries > 0) {
            console.warn(`Fetch failed, retrying... (${retries} retries left)`);
            return fetchWithRetry(url, options, retries - 1, timeout);
        } else {
            throw error;
        }
    }
}

/**
 * Utility to handle errors.
 * @param {Promise} promise - The promise to handle.
 * @returns {Promise<Object>} - Result or error information.
 */
async function handleError(promise) {
    try {
        const result = await promise;
        return { success: true, result };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

/**
 * Timeout utility.
 * @param {number} ms - The timeout duration in milliseconds.
 * @returns {Promise} - A promise that resolves after the specified duration.
 */
function timeout(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export { fetchWithRetry, handleError, timeout };