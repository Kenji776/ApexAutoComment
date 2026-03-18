// --------------------------------------------------
//  Apex Auto Comment & Docs Generator Server
// --------------------------------------------------
const express = require("express");
const { processFiles, sendAlert } = require("./processor"); // comment generator
const { processFiles: generateDocs } = require("./generateDocs"); // docs generator
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const fsExtra = require("fs-extra");
const archiver = require("archiver");
const bodyParser = require("body-parser");
const cors = require("cors");
const { getApexFiles } = require("./fileScanner");
const { randomUUID } = require("crypto");
const tokenTracker = require("./tokenTracker");
const app = express();
app.set("trust proxy", true);
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

[INPUT_DIR, OUTPUT_DIR, PUBLIC_DIR].forEach((dir) => fs.mkdirSync(dir, { recursive: true }));

console.log("📂 BASE_DIR:", BASE_DIR);
console.log("📂 PUBLIC_DIR:", PUBLIC_DIR);

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
			if (!req.jobId) req.jobId = randomUUID(); // 🔑 Create a unique job ID
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

// --------------------------------------------------
// 📊 Token Usage Endpoint
// --------------------------------------------------

/**
 * Resolves the client IP for a request.
 * Use ?simulateRemote=true during development to test as a non-localhost user.
 */
function getClientIp(req) {
	if (req.query.simulateRemote === "true") return "simulated-remote";
	return req.ip || req.socket.remoteAddress;
}

app.get("/api/token-usage", (req, res) => {
	const clientIp = getClientIp(req);
	res.json(tokenTracker.getInfo(clientIp));
});

app.post("/process", async (req, res) => {
	res.set("Access-Control-Allow-Origin", "*");

	const mode = req.query.mode || "both";
	const { variables = {}, model = "claude-sonnet-4-20250514", jobId } = req.body;
	const clientIp = getClientIp(req);

	if (!jobId) {
		return res.status(400).send({ error: "Missing jobId. Please upload first." });
	}

	// Check daily token limit
	if (!tokenTracker.isAllowed(clientIp)) {
		const info = tokenTracker.getInfo(clientIp);
		console.log(
			JSON.stringify({
				type: "error",
				status: "Daily token limit reached. Please try again tomorrow.",
			}),
		);
		return res.status(429).send({
			error: "Daily token limit reached",
			usage: info,
		});
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
			const result = await processFiles(filesToProcess, jobSrcDir, jobInputDir, variables, model);
			tokenTracker.addTokens(clientIp, result.tokensUsed);
			console.log("✅ Comment generation complete");
		}

		// --------------------------------------------------
		// 📘 Step 2: Documentation Generation
		// --------------------------------------------------
		if (mode === "docs" || mode === "both") {
			console.log(
				JSON.stringify({
					type: "docs_generating",
					status: "Generating documentation...",
				}),
			);
			await generateDocs(jobSrcDir, jobMarkdownDir, jobHtmlDir, jobDocsDir);
			console.log("✅ Documentation generation complete");
		}

		// --------------------------------------------------
		// 📦 Step 3: Zip Results
		// --------------------------------------------------
		if (fs.existsSync(jobZip)) await fsExtra.remove(jobZip);

		console.log(
			JSON.stringify({
				type: "packaging",
				status: "Packaging results...",
			}),
		);

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
		console.log(
			JSON.stringify({
				type: "error",
				status: "Processing failed due to a server error. Check the server logs for details.",
			}),
		);
		await sendAlert(`AutoComment PROCESS FAILED [${jobId}]: ${err.message}`);
		res.status(500).send({ error: "Processing failed" });
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

// Client-facing event types that should be sent via SSE
const CLIENT_EVENT_TYPES = new Set(["progress", "method_progress", "complete", "error", "docs_generating", "packaging"]);

/**
 * Writes a timestamped message to the server log file.
 */
const SERVER_LOG_FILE = path.join(process.cwd(), "server.log");
function writeToLogFile(msg) {
	try {
		const timestamp = new Date().toISOString();
		const text = typeof msg === "string" ? msg : JSON.stringify(msg);
		fs.appendFileSync(SERVER_LOG_FILE, `[${timestamp}] ${text}\n`);
	} catch (_) {
		/* don't let log failures crash the server */
	}
}

/**
 * Smart logger: inspects each console.log call.
 * - JSON with a recognized client event type → SSE + stdout + log file
 * - Everything else → stdout + log file only (never SSE)
 */
function createSmartLogger() {
	return (msg) => {
		// Always write to stdout and log file
		console._logOriginal(msg);
		writeToLogFile(msg);

		// Only forward recognized client events to SSE
		if (typeof msg === "string") {
			try {
				const parsed = JSON.parse(msg);
				if (parsed && parsed.type && CLIENT_EVENT_TYPES.has(parsed.type)) {
					sendLogToClients(msg);
				}
			} catch (_) {
				// Not JSON — server-only, don't send to clients
			}
		}
	};
}

if (!console._logOriginal) {
	console._logOriginal = console.log;
	console._errorOriginal = console.error;
	console._warnOriginal = console.warn;

	console.log = createSmartLogger();

	console.error = (...args) => {
		console._errorOriginal(...args);
		writeToLogFile(`[ERROR] ${args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ")}`);
	};

	console.warn = (...args) => {
		console._warnOriginal(...args);
		writeToLogFile(`[WARN] ${args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ")}`);
	};
}

// --------------------------------------------------
// 🌐 Root Route
// --------------------------------------------------
app.use(express.static(PUBLIC_DIR));
app.get("/", (req, res) => {
	res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

// --------------------------------------------------
// 🧹 Scheduled Cleanup (stale job files)
// --------------------------------------------------
const JOB_MAX_AGE_MS = 10 * 60 * 1000; // 10 minutes
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function cleanupStaleJobs() {
	const now = Date.now();

	for (const dir of [INPUT_DIR, OUTPUT_DIR]) {
		if (!fs.existsSync(dir)) continue;

		for (const entry of fs.readdirSync(dir)) {
			// Only clean up UUID-named job directories, not permanent subdirs like src/ or docs/
			if (!UUID_PATTERN.test(entry)) continue;

			const entryPath = path.join(dir, entry);
			try {
				const stat = fs.statSync(entryPath);
				if (stat.isDirectory() && now - stat.mtimeMs > JOB_MAX_AGE_MS) {
					fsExtra.removeSync(entryPath);
					console.log(`🧹 Cleaned up stale job directory: ${entryPath}`);
				}
			} catch (err) {
				console.error(`Failed to clean up ${entryPath}:`, err.message);
			}
		}
	}
}

// Run cleanup every minute
setInterval(cleanupStaleJobs, 60 * 1000);

// Also run once on startup to catch anything left from a previous run
cleanupStaleJobs();

// --------------------------------------------------
// 🚀 Start Server
// --------------------------------------------------
const PORT = parseInt(process.env.PORT, 10) || 3010;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
