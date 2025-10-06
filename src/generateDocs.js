// Modularized generateDocs.js
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const baseTheme = "markdown8";
const { markdown } = require("markdown");

// Logging utility
let BASE_DIR = path.resolve(__dirname);
const logFile = path.join(process.cwd(), "generateDocs.log");

function logEvent(message) {
	const timestamp = new Date().toISOString();
	const logMessage = `[${timestamp}] ${message}\n`;
	console.log(logMessage.trim());
	fs.appendFileSync(logFile, logMessage);
}

async function processFiles(sourceDir, markdownDir, htmlDir, outputDir) {
	logEvent(`Starting file processing with source:
${sourceDir},
markdown: ${markdownDir},
html: ${htmlDir},
output: ${outputDir}`);

	// Ensure Markdown, HTML, and output directories exist
	fs.mkdirSync(markdownDir, { recursive: true });
	fs.mkdirSync(htmlDir, { recursive: true });
	fs.mkdirSync(outputDir, { recursive: true });

	let apexDocsSucceeded = false;

	try {
		// Step 1: Generate Markdown files using ApexDocs
		logEvent("Generating Markdown files.");
		const apexdocsBinary = getApexDocsBinary();

		logEvent(`process.cwd() = ${process.cwd()}`);
		logEvent(`__dirname = ${BASE_DIR}`);
		logEvent(`sourceDir exists? ${fs.existsSync(sourceDir)}`);
		logEvent(`markdownDir exists? ${fs.existsSync(markdownDir)}`);
		logEvent(`ApexDocs binary: ${apexdocsBinary}`);

		const apexCommand = `${apexdocsBinary} markdown -p global public private protected namespaceaccessible -s "${sourceDir}" -t "${markdownDir}"`;

		const isWin = process.platform === "win32";

		if (isWin) {
			logEvent(`🪟 Windows environment detected`);
			logEvent(`Spawning with: cmd /c ${apexCommand}`);
			await runCommand("cmd", ["/c", apexCommand], { cwd: process.cwd() });
		} else {
			logEvent(`🐧 Linux/Docker environment detected`);
			logEvent(`Spawning with: /bin/sh -c '${apexCommand}'`);
			await runCommand("/bin/sh", ["-c", apexCommand], { cwd: process.cwd() });
		}

		logEvent(`✅ Generated Markdown files for directory: ${sourceDir}`);
		apexDocsSucceeded = true;
	} catch (error) {
		logEvent(`⚠️ ApexDocs generation failed — continuing anyway: ${error.message}`);
	}

	try {
		// Step 2: Generate HTML (only if markdown exists)
		if (fs.existsSync(markdownDir)) {
			logEvent("Generating HTML files from Markdown recursively.");
			await processMarkdownRecursively(markdownDir, htmlDir);
		} else {
			logEvent("⚠️ No markdown directory found; skipping HTML generation.");
		}

		// Step 3: Copy themes folder and themeManager.js to HTML folder
		let THEMES_ROOT = path.join(process.cwd(), "themes");
		if (!fs.existsSync(THEMES_ROOT)) {
			THEMES_ROOT = path.join(__dirname, "themes");
		}
		const themesDestPath = path.join(htmlDir, "themes");
		logEvent(`Copying themes folder from ${THEMES_ROOT} to ${themesDestPath}`);

		if (fs.existsSync(THEMES_ROOT)) {
			fs.cpSync(THEMES_ROOT, themesDestPath, { recursive: true });
			const managerSrc = path.join(BASE_DIR, "themeManager.js");
			if (fs.existsSync(managerSrc)) {
				fs.copyFileSync(managerSrc, path.join(themesDestPath, "themeManager.js"));
				logEvent("✅ Copied themeManager.js");
			}
		} else {
			logEvent(`⚠️ Themes folder not found, skipping theme copy.`);
		}

		// Step 4: Fix HTML files
		if (fs.existsSync(htmlDir)) {
			logEvent("Fixing generated HTML files.");
			fixHtml(htmlDir);
		} else {
			logEvent("⚠️ No HTML directory found; skipping HTML fix.");
		}

		logEvent("✅ Documentation generation complete (partial results possible).");
		return outputDir;
	} catch (error) {
		logEvent(`⚠️ Error during non-critical phase: ${error.stack}`);
		return outputDir; // Don't throw, continue gracefully
	}
}

// ✅ Try to locate apexdocs binary
function getApexDocsBinary() {
	const localBin = path.join(process.cwd(), "..", "node_modules", ".bin", "apexdocs");
	if (fs.existsSync(localBin)) return localBin;

	try {
		const globalRoot = require("child_process")
			.execSync("npm root -g")
			.toString()
			.trim();
		const globalBin = path.join(globalRoot, ".bin", "apexdocs");
		if (fs.existsSync(globalBin)) return globalBin;
	} catch (err) {
		logEvent("Could not determine global npm root.");
	}

	return "apexdocs"; // fallback
}

async function processMarkdownRecursively(markdownDir, htmlDir) {
	const items = fs.readdirSync(markdownDir);
	for (const item of items) {
		const itemPath = path.join(markdownDir, item);
		const itemHtmlPath = path.join(htmlDir, item);
		const stats = fs.statSync(itemPath);
		if (stats.isDirectory()) {
			if (!fs.existsSync(itemHtmlPath)) fs.mkdirSync(itemHtmlPath, { recursive: true });
			await processMarkdownRecursively(itemPath, itemHtmlPath);
		} else if (item.endsWith(".md")) {
			const htmlFilePath = itemHtmlPath.replace(/\.md$/, ".html");
			try {
				const input = fs.readFileSync(itemPath, "utf-8");
				const htmlBody = markdown.toHTML(input);
				const fullHtml = `
					<!DOCTYPE html>
					<html>
					<head>
					<meta charset="UTF-8">
					<title>${path.basename(itemHtmlPath, ".html")}</title>
					<link rel="stylesheet" href="${baseTheme}.css" id="_theme">
					</head>
					<body>
					<div id="_html" class="markdown-body">
						${htmlBody}
					</div>
					</body>
					</html>`;
				fs.writeFileSync(htmlFilePath, fullHtml);
				logEvent(`Generated HTML for: ${itemPath}`);
			} catch (err) {
				logEvent(`Error generating HTML for ${itemPath}: ${err.message}`);
			}
		}
	}
}

function fixHtml(directory) {
	const filesToModify = getFilesRecursively(directory, ["html"]);
	logEvent("Fixing HTML files");

	for (const fileName of filesToModify) {
		try {
			const fileContents = fs.readFileSync(fileName, "utf-8");
			let newFile = fileContents
				.replaceAll(".md", ".html")
				.replaceAll("<body>", `<body><link rel="stylesheet" type="text/css" href="${baseTheme}.css" id="_theme"><div id="_html" class="markdown-body">` + injectStylePicker(baseTheme))
				.replaceAll("</body>", "</div></body>")
				.replaceAll('<h2 id="layout-default">layout: default</h2>', "")
				.replaceAll('href="/', 'href="');
			fs.writeFileSync(fileName, unescapeHTML(newFile));
			logEvent(`HTML fixed for file: ${fileName}`);
		} catch (err) {
			logEvent(`Error fixing HTML in file: ${fileName} - ${err.message}`);
		}
	}
	logEvent("HTML fixing complete.");
}

function injectStylePicker(defaultStyle) {
	let THEMES_ROOT = path.join(process.cwd(), "themes");
	if (!fs.existsSync(THEMES_ROOT)) {
		THEMES_ROOT = path.join(__dirname, "themes");
	}
	const themes = getFilesRecursively(THEMES_ROOT, ["css"]);
	let options = "";
	themes.forEach((themeFile) => {
		const themeFileName = path.basename(themeFile);
		const themeName = themeFileName.replace(".css", "");
		options += `<option value="${themeFileName}">${themeName}</option>`;
	});
	return `
    <!-- Theme manager UI -->
    <div id="themeChooser" style="float:right; margin:0.5em 0;">
      <label for="theme_select">Theme:</label>
      <select id="theme_select">${options}</select>
    </div>

    <script>
      (function() {
        const afterHtml = window.location.pathname.split('/html/')[1] || "";
        const ups = afterHtml.split('/').length - 1;
        let prefix = "";
        for (let i = 0; i < ups; i++) prefix += "../";
        const script = document.createElement('script');
        script.src = prefix + "themes/themeManager.js";
        document.head.appendChild(script);
      })();
    </script>`;
}

function unescapeHTML(escapedHTML) {
	return escapedHTML
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&amp;/g, "&");
}

function getFilesRecursively(directory, fileTypes, files) {
	if (!files) files = [];
	if (!fs.existsSync(directory)) return files;
	fs.readdirSync(directory).forEach((File) => {
		const absolute = path.join(directory, File);
		const stats = fs.statSync(absolute);
		if (stats.isDirectory()) return getFilesRecursively(absolute, fileTypes, files);
		const ext = File.split(".").pop();
		if (!fileTypes || fileTypes.includes(ext)) files.push(absolute);
	});
	return files;
}

function runCommand(cmd, args, options = {}) {
	return new Promise((resolve, reject) => {
		const fullCmd = `${cmd} ${args.join(" ")}`;
		logEvent(`Spawning: ${fullCmd}`);
		logEvent(`Options.cwd = ${options.cwd || process.cwd()}`);
		const proc = spawn(cmd, args, {
			stdio: "inherit",
			shell: process.platform === "win32",
			...options,
		});
		proc.on("error", (err) => {
			logEvent(`⚠️ Spawn error: ${err.message}`);
			reject(err);
		});
		proc.on("close", (code) => {
			logEvent(`Process exited with code ${code}`);
			if (code !== 0) return reject(new Error(`${cmd} exited with code ${code}`));
			resolve();
		});
	});
}

module.exports = { processFiles };
