const { processFiles } = require('./processor');
const { getApexFiles } = require('./fileScanner');
const fs = require('fs');
const path = require('path');

const inputPath = process.argv[2];

if (!inputPath) {
    console.error('⚠️ Please provide a file or folder path.');
    process.exit(1);
}

(async () => {
    let filesToProcess = [];

    if (fs.statSync(inputPath).isDirectory()) {
        console.log(`🔍 Scanning directory: ${inputPath}`);
        filesToProcess = getApexFiles(inputPath);
    } else if (inputPath.endsWith('.cls')) {
        filesToProcess = [inputPath];
    } else {
        console.error('⚠️ Path must be a folder or .cls file.');
        process.exit(1);
    }

    if (filesToProcess.length === 0) {
        console.warn('⚠️ No Apex class files found.');
        return;
    }

    await processFiles(filesToProcess);
})();
