// src/dependencyResolver.js

const fs = require('fs');
const path = require('path');

/**
 * Recursively resolve class/method dependencies up to a specified depth.
 *
 * @param {string} fileContent - The code content to scan.
 * @param {string} inputDir - The base directory to look for referenced classes.
 * @param {Set<string>} scannedClasses - Classes we've already scanned (avoid circular refs).
 * @param {Set<string>} addedReferences - Classes we've already added as reference blocks.
 * @param {number} depth - Current depth.
 * @param {number} maxDepth - Maximum recursion depth.
 * @returns {string[]} Array of reference code blocks as strings.
 */
function resolveDependencies(fileContent, inputDir, scannedClasses = new Set(), addedReferences = new Set(), depth = 1, maxDepth = 3) {
    if (depth > maxDepth) return [];

    const references = findReferencedMethods(fileContent);
    const contextBlocks = [];

    let totalDependencies = Object.keys(references).length;
    let successfulResolutions = 0;

    for (const [className, methodSet] of Object.entries(references)) {
        if (scannedClasses.has(className)) continue;
        scannedClasses.add(className);

        const classFilePath = findClassFile(className, inputDir);
        if (!classFilePath) {
            //console.warn(`⚠️ Class file not found for referenced class: ${className}`);
            continue;
        }

        if (addedReferences.has(className)) {
            //console.log(`ℹ️ Already included reference for class: ${className}, skipping.`);
            continue;
        }

        //console.log(`🔍 Adding reference for class: ${className} (depth ${depth}) from ${classFilePath}`);

        const classFileContent = fs.readFileSync(classFilePath, 'utf-8');
        const referencedMembers = extractReferencedMembers(classFileContent, className, methodSet);

        if (referencedMembers.length > 0) {
            successfulResolutions++;
            addedReferences.add(className);
            contextBlocks.push(`=== REFERENCE: Class ${className} (${path.relative(inputDir, classFilePath)}) ===\n${referencedMembers.join('\n')}\n=== END REFERENCE ===\n`);
        }

        const nestedContext = resolveDependencies(classFileContent, inputDir, scannedClasses, addedReferences, depth + 1, maxDepth);
        contextBlocks.push(...nestedContext);
    }

    //console.log(`🔎 Dependency resolution summary (depth ${depth}): Tried ${totalDependencies}, Successfully resolved ${successfulResolutions}`);

    return contextBlocks;
}

/**
 * Extracts class and method names referenced in the given code.
 * Returns an object mapping class names to sets of method/property names.
 */
function findReferencedMethods(code) {
    const matches = [...code.matchAll(/\b([A-Z][A-Za-z0-9_]*)\.([a-zA-Z_][A-Za-z0-9_]*)\b/g)];
    const builtInClasses = new Set(['System', 'Database', 'Math', 'String', 'Date', 'List', 'Set', 'Map', 'JSON', 'Boolean', 'Datetime', 'SObject', 'Object', 'Id', 'ID', 'FieldSets', 'EventBus', 'Schema', 'UserInfo','Test','DateTime','SObjectType']);

    const references = {};
    for (const match of matches) {
        const className = match[1];
        const memberName = match[2];
        if (!builtInClasses.has(className)) {
            if (!references[className]) {
                references[className] = new Set();
            }
            references[className].add(memberName);
        }
    }
    return references;
}

/**
 * Extracts only the specified methods and properties of a class.
 */
function extractReferencedMembers(fileContent, className, referencedMembers = new Set()) {
    const lines = fileContent.split('\n');
    const relevantLines = [];

    let insideClass = false;
    let capturing = false;
    let braceCount = 0;
    let currentCapture = [];
    const methodSignatureRegex = /\b(public|private|protected|global|static|virtual|override|final)\b[\s\S]*?\b([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/;

    for (const line of lines) {
        if (!insideClass && new RegExp(`\\bclass\\s+${className}\\b`).test(line)) {
            insideClass = true;
            relevantLines.push(line); // include class declaration
            continue;
        }

        if (!insideClass) {
            continue;
        }

        if (!capturing) {
            const methodMatch = line.match(methodSignatureRegex);
            if (methodMatch) {
                const methodName = methodMatch[2];

                if (referencedMembers.has(methodName)) {
                    capturing = true;
                    braceCount += (line.match(/{/g) || []).length;
                    braceCount -= (line.match(/}/g) || []).length;
                    currentCapture.push(line);

                    // Handle single-line methods (no braces)
                    if (braceCount === 0 && !line.includes('{')) {
                        // Assume it's a one-liner or unbraced declaration
                        relevantLines.push(currentCapture.join('\n'));
                        capturing = false;
                        currentCapture = [];
                    }
                }
            }
        } else {
            braceCount += (line.match(/{/g) || []).length;
            braceCount -= (line.match(/}/g) || []).length;
            currentCapture.push(line);

            if (braceCount <= 0) {
                relevantLines.push(currentCapture.join('\n'));
                capturing = false;
                currentCapture = [];
                braceCount = 0;
            }
        }
    }

    return relevantLines;
}

/**
 * Looks for a file matching ClassName.cls in the given directory.
 */
function findClassFile(className, inputDir) {
    const candidates = fs.readdirSync(inputDir).filter(f => f === `${className}.cls`);
    if (candidates.length > 0) {
        return path.join(inputDir, candidates[0]);
    }

    return null;
}

module.exports = {
    resolveDependencies,
    findReferencedMethods,
};
