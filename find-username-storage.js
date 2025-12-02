// Diagnostic script to find where username is stored
// Run this in browser console at https://rainbet.com

console.log('🔍 Searching for username storage...\n');

const username = 'DegenGlenzzz';
const results = {
    localStorage: [],
    sessionStorage: [],
    cookies: [],
    window: [],
    indexedDB: []
};

// 1. Check localStorage
console.log('📦 Checking localStorage...');
for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    const value = localStorage.getItem(key);
    
    try {
        if (value && value.includes(username)) {
            console.log(`✅ Found in localStorage["${key}"]`);
            results.localStorage.push({ key, value: value.substring(0, 200) });
        }
    } catch (e) {}
}

// 2. Check sessionStorage
console.log('📦 Checking sessionStorage...');
for (let i = 0; i < sessionStorage.length; i++) {
    const key = sessionStorage.key(i);
    const value = sessionStorage.getItem(key);
    
    try {
        if (value && value.includes(username)) {
            console.log(`✅ Found in sessionStorage["${key}"]`);
            results.sessionStorage.push({ key, value: value.substring(0, 200) });
        }
    } catch (e) {}
}

// 3. Check cookies
console.log('📦 Checking cookies...');
const cookies = document.cookie.split(';');
for (const cookie of cookies) {
    if (cookie.includes(username)) {
        console.log(`✅ Found in cookie: ${cookie.substring(0, 100)}`);
        results.cookies.push(cookie.substring(0, 200));
    }
}

// 4. Check window object
console.log('📦 Checking window object...');
const checkWindowObject = (obj, prefix = 'window', depth = 0) => {
    if (depth > 3) return; // Limit recursion
    
    try {
        for (const key in obj) {
            if (!key.startsWith('_')) continue; // Check underscore-prefixed properties
            
            const val = obj[key];
            if (typeof val === 'string' && val.includes(username)) {
                console.log(`✅ Found in ${prefix}.${key}`);
                results.window.push({ path: `${prefix}.${key}`, value: val.substring(0, 200) });
            }
            
            if (typeof val === 'object' && val !== null && depth < 2) {
                checkWindowObject(val, `${prefix}.${key}`, depth + 1);
            }
        }
    } catch (e) {}
};

checkWindowObject(window);

// 5. Parse localStorage for JSON with username
console.log('📦 Parsing JSON objects in localStorage...');
for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    const value = localStorage.getItem(key);
    
    try {
        const parsed = JSON.parse(value);
        const stringified = JSON.stringify(parsed);
        
        if (stringified.includes(username)) {
            console.log(`✅ Found username in JSON at localStorage["${key}"]`);
            results.localStorage.push({ 
                key, 
                type: 'JSON',
                value: parsed,
                path: findPathToUsername(parsed, username)
            });
        }
    } catch (e) {}
}

// Helper function to find path to username in object
function findPathToUsername(obj, username, path = '') {
    try {
        for (const key in obj) {
            const val = obj[key];
            const currentPath = path ? `${path}.${key}` : key;
            
            if (typeof val === 'string' && val === username) {
                return currentPath;
            }
            
            if (typeof val === 'object' && val !== null) {
                const found = findPathToUsername(val, username, currentPath);
                if (found) return found;
            }
        }
    } catch (e) {}
    return null;
}

// 6. Summary
console.log('\n📊 RESULTS SUMMARY:');
console.log('===================');
console.log(`localStorage entries: ${results.localStorage.length}`);
console.log(`sessionStorage entries: ${results.sessionStorage.length}`);
console.log(`cookie entries: ${results.cookies.length}`);
console.log(`window properties: ${results.window.length}`);

// 7. All localStorage keys for reference
console.log('\n📋 All localStorage keys:');
const allKeys = [];
for (let i = 0; i < localStorage.length; i++) {
    allKeys.push(localStorage.key(i));
}
console.table(allKeys);

// Export results
window.usernameSearchResults = results;
console.log('\n✅ Results saved to: window.usernameSearchResults');
console.log('You can access results like: window.usernameSearchResults.localStorage');
