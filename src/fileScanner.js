const fs = require('fs');
const path = require('path');

/**
 * Recursively scans a directory and returns paths to all .cls files.
 * @param {string} dir - The starting directory.
 * @returns {string[]} - List of file paths.
 */
function getApexFiles(dir) {
    let results = [];
    const list = fs.readdirSync(dir);

    list.forEach(file => {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);

        if (stat && stat.isDirectory()) {
            results = results.concat(getApexFiles(filePath)); // Recursive for subfolders
        } else if (file.endsWith('.cls')) {
            results.push(filePath);
        }
    });

    return results;
}

module.exports = { getApexFiles };
