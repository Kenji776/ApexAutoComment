// --------------------------------------------------
//  Apex Auto Comment & Docs Generator Server
// --------------------------------------------------
const express = require("express");
const { processFiles } = require("./processor"); // comment generator
const { processFiles: generateDocs } = require("./generateDocs"); // docs generator
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const fsExtra = require("fs-extra");
const archiver = require("archiver");
const bodyParser = require("body-parser");
const cors = require("cors");
const { getApexFiles } = require("./fileScanner");

const app = express();
app.use(cors());
app.use(bodyParser.json());

// --------------------------------------------------
// 🔧 Path Setup (Docker-safe)
// --------------------------------------------------
// Determine base directory — project root in both Docker and local runs
let BASE_DIR = path.resolve(__dirname); // always /src


const INPUT_DIR = path.join(BASE_DIR, "input");
const OUTPUT_DIR = path.join(BASE_DIR, "output");
const PUBLIC_DIR = path.join(BASE_DIR, "public");
const SRC_DIR = path.join(OUTPUT_DIR, "src");
const DOCS_DIR = path.join(OUTPUT_DIR, "docs");
const MARKDOWN_DIR = path.join(DOCS_DIR, "markdown");
const HTML_DIR = path.join(DOCS_DIR, "html");
const FINAL_ZIP = path.join(OUTPUT_DIR, "final_output.zip");

[INPUT_DIR, OUTPUT_DIR, SRC_DIR, DOCS_DIR, MARKDOWN_DIR, HTML_DIR].forEach((dir) =>
  fs.mkdirSync(dir, { recursive: true })
);

console.log("📂 BASE_DIR:", BASE_DIR);
console.log("📂 PUBLIC_DIR:", PUBLIC_DIR);

// Ensure required directories exist
[INPUT_DIR, OUTPUT_DIR, SRC_DIR, DOCS_DIR, MARKDOWN_DIR, HTML_DIR, PUBLIC_DIR].forEach((dir) => fs.mkdirSync(dir, { recursive: true }));

// --------------------------------------------------
// 🧱 Static Frontend
// --------------------------------------------------
app.use(express.static(PUBLIC_DIR));

// --------------------------------------------------
// 📤 File Upload Endpoint
// --------------------------------------------------
const storage = multer.diskStorage({
	destination: (req, file, cb) => cb(null, INPUT_DIR),
	filename: (req, file, cb) => cb(null, file.originalname),
});
const upload = multer({ storage });
let logClients = [];

app.post("/upload", upload.array("files"), (req, res) => {
	if (!req.files.length) return res.status(400).send({ error: "No files uploaded." });
	res.send({ message: `${req.files.length} file(s) uploaded.` });
});

// --------------------------------------------------
// ⚙️  Process Endpoint
// --------------------------------------------------
app.post("/process", async (req, res) => {
	res.set("Access-Control-Allow-Origin", "*");
	const mode = req.query.mode || "both"; // comments, docs, or both
	const llmPromptVariables = req.body.variables || {};
	const model = req.body.model || "gpt-4o";

	try {
		// 🔍 Gather Apex files
		let filesToProcess = [];
		if (fs.statSync(INPUT_DIR).isDirectory()) {
			console.log(`🔍 Scanning directory: ${INPUT_DIR}`);
			filesToProcess = getApexFiles(INPUT_DIR);
		} else if (INPUT_DIR.endsWith(".cls")) {
			filesToProcess = [INPUT_DIR];
		} else {
			return res.status(400).send({ error: "Path must be a folder or .cls file." });
		}

		if (!filesToProcess.length) return res.status(400).send({ error: "No Apex class files found." });

		const PROCESSED_SRC_DIR = path.join(OUTPUT_DIR, "src");
		await fsExtra.ensureDir(PROCESSED_SRC_DIR);

		console.log(`🗂 Using SRC_DIR = ${PROCESSED_SRC_DIR}`);
		console.log(`🗂 Using DOCS_DIR = ${DOCS_DIR}`);

		// --------------------------------------------------
		// 🧩 Step 0: Copy metadata XMLs so ApexDocs can find them
		// --------------------------------------------------
		console.log("📂 Copying metadata (.cls-meta.xml) files to SRC_DIR...");
		for (const clsFile of filesToProcess) {
			const metaFile = clsFile.replace(/\.cls$/i, ".cls-meta.xml");
			if (fs.existsSync(metaFile)) {
				const destFile = path.join(PROCESSED_SRC_DIR, path.basename(metaFile));
				await fsExtra.copy(metaFile, destFile);
				console.log(`   ✅ Copied: ${path.basename(metaFile)}`);
			} else {
				console.warn(`   ⚠️ No metadata found for ${path.basename(clsFile)}`);
			}
		}

		// --------------------------------------------------
		// 🧠 Step 1: Generate Comments
		// --------------------------------------------------
		if (mode === "comments" || mode === "both") {
			console.log("🧠 Running comment generation...");
			await processFiles(filesToProcess, PROCESSED_SRC_DIR, INPUT_DIR, llmPromptVariables, model);
			console.log("✅ Comment generation complete.");
		}

		// If "docs" mode only, copy raw .cls files into PROCESSED_SRC_DIR
		if (mode === "docs") {
			for (const clsFile of filesToProcess) {
				const clsDest = path.join(PROCESSED_SRC_DIR, path.basename(clsFile));
				await fsExtra.copy(clsFile, clsDest);
				console.log(`   ✅ Copied class file: ${path.basename(clsFile)}`);
			}
		}

		// --------------------------------------------------
		// 📘 Step 2: Generate Documentation
		// --------------------------------------------------
		if (mode === "docs" || mode === "both") {
			console.log("📘 Running documentation generation...");
			await generateDocs(PROCESSED_SRC_DIR, MARKDOWN_DIR, HTML_DIR, DOCS_DIR);
			console.log("✅ Documentation generation complete.");

			// 🧾 Copy log into docs folder for traceability
			const logSrc = path.join(BASE_DIR, "src", "generateDocs.log");
			const logDest = path.join(DOCS_DIR, "generateDocs.log");
			if (fs.existsSync(logSrc)) {
				await fsExtra.copyFile(logSrc, logDest);
				console.log("🧾 Copied generateDocs.log into docs folder.");
			} else {
				console.warn("⚠️ generateDocs.log not found — skipping copy.");
			}
		}

		// --------------------------------------------------
		// 📦 Step 3: Create Final ZIP
		// --------------------------------------------------
		if (fs.existsSync(FINAL_ZIP)) {
			console.log("🧹 Removing old ZIP...");
			await fsExtra.remove(FINAL_ZIP);
		}

		console.log("📦 Creating new ZIP...");
		const archive = archiver("zip", { zlib: { level: 9 } });
		const output = fs.createWriteStream(FINAL_ZIP);
		archive.pipe(output);

		if (fs.existsSync(PROCESSED_SRC_DIR)) archive.directory(PROCESSED_SRC_DIR, "src");
		if (fs.existsSync(DOCS_DIR)) archive.directory(DOCS_DIR, "docs");

		await archive.finalize();

		output.on("close", () => {
			console.log(`✅ Final ZIP ready (${archive.pointer()} bytes)`);
			res.download(FINAL_ZIP, "final_output.zip", (err) => {
				if (err) console.error("Error sending ZIP:", err);
			});
		});

		output.on("error", (err) => {
			console.error("Error writing ZIP:", err);
			res.status(500).send({ error: "Failed to create ZIP." });
		});
	} catch (err) {
		console.error("❌ PROCESS FAILED:", err);
		res.status(500).send({ error: "Processing failed", details: err.message });
	}
});

// --------------------------------------------------
// 🧹 Cleanup Endpoint
// --------------------------------------------------
app.post("/cleanup-input", async (req, res) => {
	res.set("Access-Control-Allow-Origin", "*");
	try {
		await fsExtra.emptyDir(INPUT_DIR);
		await fsExtra.emptyDir(OUTPUT_DIR);
		res.send({ message: "Input and output folders cleaned." });
	} catch (err) {
		console.error(err);
		res.status(500).send({ error: "Failed to clean input/output folders." });
	}
});

// --------------------------------------------------
// 📡 Live Log Streaming (SSE)
// --------------------------------------------------
app.get("/logs", (req, res) => {
	res.setHeader("Content-Type", "text/event-stream");
	res.setHeader("Cache-Control", "no-cache");
	res.setHeader("Connection", "keep-alive");
	res.flushHeaders();

	const clientId = Date.now();
	logClients.push(res);

	req.on("close", () => {
		logClients = logClients.filter((client) => client !== res);
	});
});

function sendLogToClients(message) {
	const clean = typeof message === "string" ? message : JSON.stringify(message);
	const event = `data: ${clean.replace(/\n/g, "")}\n\n`;
	for (const client of logClients) {
		client.write(event);
	}
}

function createLiveLogger() {
	return (msg) => {
		console._logOriginal(msg);
		try {
			sendLogToClients(msg);
		} catch (err) {
			console._logOriginal("⚠️ Error streaming log to client:", err);
		}
	};
}

if (!console._logOriginal) {
	console._logOriginal = console.log;
	console.log = createLiveLogger();
}

// --------------------------------------------------
// 🌐 Root Route
// --------------------------------------------------
app.use(express.static(PUBLIC_DIR));
app.get("/", (req, res) => {
	res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

// --------------------------------------------------
// 🚀 Start Server
// --------------------------------------------------
const PORT = parseInt(process.env.PORT, 10) || 3010;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
