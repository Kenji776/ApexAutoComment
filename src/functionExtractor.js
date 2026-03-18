// src/functionExtractor.js

const fs = require("fs");

/**
 * Extracts all top-level methods (static or instance) from an Apex class file.
 * Captures decorators (annotations) like @AuraEnabled, @future, etc.
 *
 * @param {string} fileContent - Full Apex class content.
 * @returns {Array<{ startLine: number, endLine: number, methodName: string, declarationBlock: string, bodyContent: string }>}
 */
function extractFunctions(fileContent) {
	const lines = fileContent.split("\n");
	const functionBlocks = [];

	let insideBlockComment = false;
	let insideMethod = false;
	let foundOpenBrace = false; // tracks if we've seen the first { yet
	let braceCount = 0;

	let startLine = -1;
	let currentDeclarationLines = [];
	let currentBodyLines = [];
	let methodName = "";

	const methodSignatureRegex = /\b(public|private|protected|global)\b[\s\S]*?\b([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/;

	for (let i = 0; i < lines.length; i++) {
		const trimmed = lines[i].trim();

		// Track block comments
		if (trimmed.startsWith("/**")) insideBlockComment = true;
		if (insideBlockComment) {
			if (trimmed.endsWith("*/")) insideBlockComment = false;
			continue;
		}

		// Skip single-line comments
		if (trimmed.startsWith("//")) continue;

		// Detect start of a method block: decorator or method signature
		if (!insideMethod && (trimmed.startsWith("@") || methodSignatureRegex.test(trimmed))) {
			if (startLine === -1) {
				startLine = i;
			}

			currentDeclarationLines.push(lines[i]);

			const match = trimmed.match(methodSignatureRegex);
			if (match) {
				methodName = match[2];
				insideMethod = true;
				foundOpenBrace = false;

				// Check if the opening brace is on this same line
				if (trimmed.includes("{")) {
					foundOpenBrace = true;
					braceCount += (trimmed.match(/{/g) || []).length;
					braceCount -= (trimmed.match(/}/g) || []).length;

					// Single-line method with body on same line (rare but possible)
					if (braceCount <= 0) {
						functionBlocks.push({
							startLine,
							endLine: i,
							methodName,
							declarationBlock: currentDeclarationLines.join("\n"),
							bodyContent: "",
						});

						insideMethod = false;
						foundOpenBrace = false;
						startLine = -1;
						currentDeclarationLines = [];
						methodName = "";
						braceCount = 0;
					}
				}
				// If no brace on this line, we'll keep scanning for it
			}

			continue;
		}

		// If we haven't yet started a method block, ignore lines that aren't decorators or method signatures
		if (!insideMethod && startLine !== -1) {
			startLine = -1;
			currentDeclarationLines = [];
		}

		// Inside the method but haven't found the opening brace yet
		// These are continuation lines of the declaration (multi-line params, closing paren, etc.)
		if (insideMethod && !foundOpenBrace) {
			currentDeclarationLines.push(lines[i]);

			if (trimmed.includes("{")) {
				foundOpenBrace = true;
				braceCount += (trimmed.match(/{/g) || []).length;
				braceCount -= (trimmed.match(/}/g) || []).length;

				if (braceCount <= 0) {
					functionBlocks.push({
						startLine,
						endLine: i,
						methodName,
						declarationBlock: currentDeclarationLines.join("\n"),
						bodyContent: "",
					});

					insideMethod = false;
					foundOpenBrace = false;
					startLine = -1;
					currentDeclarationLines = [];
					methodName = "";
					braceCount = 0;
				}
			}

			// If the line ends with a semicolon and no brace, it's an abstract/interface method
			if (!foundOpenBrace && trimmed.endsWith(";")) {
				functionBlocks.push({
					startLine,
					endLine: i,
					methodName,
					declarationBlock: currentDeclarationLines.join("\n"),
					bodyContent: "",
				});

				insideMethod = false;
				foundOpenBrace = false;
				startLine = -1;
				currentDeclarationLines = [];
				methodName = "";
				braceCount = 0;
			}

			continue;
		}

		// Inside the method body (past the opening brace)
		if (insideMethod && foundOpenBrace) {
			currentBodyLines.push(lines[i]);

			braceCount += (trimmed.match(/{/g) || []).length;
			braceCount -= (trimmed.match(/}/g) || []).length;

			if (braceCount <= 0) {
				functionBlocks.push({
					startLine,
					endLine: i,
					methodName,
					declarationBlock: currentDeclarationLines.join("\n"),
					bodyContent: currentBodyLines.join("\n"),
				});

				insideMethod = false;
				foundOpenBrace = false;
				startLine = -1;
				currentDeclarationLines = [];
				currentBodyLines = [];
				methodName = "";
				braceCount = 0;
			}
		}
	}

	return functionBlocks;
}

/**
 * Extracts the class declaration and body from an Apex class file.
 * Preserves decorators/annotations and declaration modifiers.
 *
 * @param {string} fileContent - Full text content of the file.
 * @returns {{
 *   startLine: number,
 *   endLine: number,
 *   declarationBlock: string, // includes annotations and class declaration
 *   bodyContent: string
 * }}
 */
function extractClassBlock(fileContent) {
	const lines = fileContent.split("\n");
	let insideBlockComment = false;
	let declarationStartLine = -1;
	let declarationEndLine = -1;
	let braceCount = 0;
	let insideClass = false;
	const declarationLines = [];
	const bodyLines = [];

	let i = 0;
	// Detect block comment above class
	while (i < lines.length) {
		const trimmed = lines[i].trim();
		if (trimmed.startsWith("/**")) {
			insideBlockComment = true;
		}

		if (insideBlockComment && trimmed.endsWith("*/")) {
			insideBlockComment = false;
			i++; // Move past the comment block
			continue;
		}

		if (!insideBlockComment && /\b(class|interface|enum)\b/.test(trimmed)) {
			declarationStartLine = i;
			break;
		}

		i++;
	}

	// Now capture the class declaration (including decorators)
	let j = declarationStartLine;
	while (j < lines.length) {
		const trimmed = lines[j].trim();
		if (trimmed.startsWith("@")) {
			declarationLines.push(lines[j]);
			j++;
			continue;
		}

		if (/\b(class|interface|enum)\b/.test(trimmed)) {
			declarationLines.push(lines[j]);
			j++;
			insideClass = true;
			break;
		}

		break; // Shouldn't happen, but safety
	}

	// Capture the body
	for (; j < lines.length; j++) {
		const trimmed = lines[j].trim();
		bodyLines.push(lines[j]);
		braceCount += (trimmed.match(/{/g) || []).length;
		braceCount -= (trimmed.match(/}/g) || []).length;

		if (braceCount === 0) {
			declarationEndLine = j;
			break;
		}
	}

	if (declarationStartLine === -1) {
		throw new Error("❌ No class declaration found.");
	}

	return {
		startLine: declarationStartLine,
		endLine: declarationEndLine,
		declarationBlock: declarationLines.join("\n"),
		bodyContent: bodyLines.join("\n"),
	};
}

/**
 * Extracts the method name from a method signature line.
 */
function extractMethodName(signatureLine) {
	const match = signatureLine.match(/\b([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/);
	return match ? match[1] : "unknownMethod";
}

module.exports = {
	extractFunctions,
	extractClassBlock,
};
