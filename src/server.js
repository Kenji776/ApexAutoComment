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
const { v4: uuidv4 } = require("uuid");
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
	destination: async (req, file, cb) => {
		try {
			if (!req.jobId) req.jobId = uuidv4(); // 🔑 Create a unique job ID
			const jobInputDir = path.join(INPUT_DIR, req.jobId);
			await fsExtra.ensureDir(jobInputDir);
			cb(null, jobInputDir);
		} catch (err) {
			cb(err);
		}
	},
	filename: (req, file, cb) => cb(null, file.originalname),
});
const upload = multer({ storage });
let logClients = [];

app.post("/upload", upload.array("files"), (req, res) => {
	if (!req.files || !req.files.length) {
		return res.status(400).send({ error: "No files uploaded." });
	}

	res.send({
		message: `${req.files.length} file(s) uploaded successfully.`,
		jobId: req.jobId, // 🔑 send this back to frontend
	});
});

app.post("/process", async (req, res) => {
	res.set("Access-Control-Allow-Origin", "*");

	const mode = req.query.mode || "both";
	const { variables = {}, model = "gpt-4o", jobId } = req.body;

	if (!jobId) {
		return res.status(400).send({ error: "Missing jobId. Please upload first." });
	}

	// Define per-job directories
	const jobInputDir = path.join(INPUT_DIR, jobId);
	const jobOutputDir = path.join(OUTPUT_DIR, jobId);
	const jobSrcDir = path.join(jobOutputDir, "src");
	const jobDocsDir = path.join(jobOutputDir, "docs");
	const jobMarkdownDir = path.join(jobDocsDir, "markdown");
	const jobHtmlDir = path.join(jobDocsDir, "html");
	const jobZip = path.join(jobOutputDir, "final_output.zip");

	try {
		await fsExtra.ensureDir(jobSrcDir);
		await fsExtra.ensureDir(jobDocsDir);
		await fsExtra.ensureDir(jobMarkdownDir);
		await fsExtra.ensureDir(jobHtmlDir);

		console.log(`📂 Processing job ${jobId}`);
		console.log(`🧾 Input: ${jobInputDir}`);
		console.log(`🧾 Output: ${jobOutputDir}`);

		// 🔍 Gather Apex files
		const filesToProcess = getApexFiles(jobInputDir);
		if (!filesToProcess.length) return res.status(400).send({ error: "No Apex class files found in uploaded job folder." });

		// --------------------------------------------------
		// 🧩 Step 0: Copy meta files
		// --------------------------------------------------
		for (const clsFile of filesToProcess) {
			const metaFile = clsFile.replace(/\.cls$/i, ".cls-meta.xml");
			if (fs.existsSync(metaFile)) {
				await fsExtra.copy(metaFile, path.join(jobSrcDir, path.basename(metaFile)));
			}
		}

		// --------------------------------------------------
		// 🧠 Step 1: Comment Generation
		// --------------------------------------------------
		if (mode === "comments" || mode === "both") {
			await processFiles(filesToProcess, jobSrcDir, jobInputDir, variables, model);
			console.log("✅ Comment generation complete");
		}

		// --------------------------------------------------
		// 📘 Step 2: Documentation Generation
		// --------------------------------------------------
		if (mode === "docs" || mode === "both") {
			await generateDocs(jobSrcDir, jobMarkdownDir, jobHtmlDir, jobDocsDir);
			console.log("✅ Documentation generation complete");
		}

		// --------------------------------------------------
		// 📦 Step 3: Zip Results
		// --------------------------------------------------
		if (fs.existsSync(jobZip)) await fsExtra.remove(jobZip);

		console.log("📦 Creating final ZIP...");
		const archive = archiver("zip", { zlib: { level: 9 } });
		const output = fs.createWriteStream(jobZip);
		archive.pipe(output);

		if (fs.existsSync(jobSrcDir)) archive.directory(jobSrcDir, "src");
		if (fs.existsSync(jobDocsDir)) archive.directory(jobDocsDir, "docs");

		await archive.finalize();

		output.on("close", async () => {
			console.log(`✅ Job ${jobId} ZIP ready (${archive.pointer()} bytes)`);

			res.download(jobZip, "final_output.zip", async (err) => {
				if (err) {
					console.error("Error sending ZIP:", err);
					res.status(500).send({ error: "Failed to send ZIP." });
				}

				// 🧹 Cleanup after sending
				try {
					console.log(`🧹 Cleaning up job ${jobId} directories...`);
					await fsExtra.remove(jobInputDir);
					await fsExtra.remove(jobOutputDir);
					console.log(`✅ Job ${jobId} cleaned up successfully.`);
				} catch (cleanupErr) {
					console.warn(`⚠️ Cleanup failed for job ${jobId}:`, cleanupErr);
				}
			});
		});

		output.on("error", (err) => {
			console.error("Error writing ZIP:", err);
			res.status(500).send({ error: "Failed to create ZIP." });
		});
	} catch (err) {
		console.error(`❌ PROCESS FAILED [${jobId}]:`, err);
		res.status(500).send({ error: "Processing failed", details: err.message });
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
