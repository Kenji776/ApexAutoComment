const express = require("express");
const { processFiles } = require("./processor");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const fsExtra = require("fs-extra");
const archiver = require("archiver");
const bodyParser = require("body-parser");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(bodyParser.json());

app.use(express.static(path.join(__dirname, "..", "public")));

const INPUT_DIR = path.join(__dirname, "..", "input");
const OUTPUT_DIR = path.join(__dirname, "..", "output");

// Ensure directories exist
fs.mkdirSync(INPUT_DIR, { recursive: true });
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

/** --- File Upload Endpoint --- */
const storage = multer.diskStorage({
	destination: (req, file, cb) => cb(null, INPUT_DIR),
	filename: (req, file, cb) => cb(null, file.originalname),
});
const upload = multer({ storage });
let logClients = [];
app.post("/upload", upload.array("files"), (req, res) => {
	if (!req.files.length)
		return res.status(400).send({ error: "No files uploaded." });
	res.send({ message: `${req.files.length} file(s) uploaded.` });
});

/** --- Process Endpoint (already provided) --- */
const { getApexFiles } = require("./fileScanner"); // assumes this exists


app.post("/process", async (req, res) => {
	res.set("Access-Control-Allow-Origin", "*");

	const inputPath = INPUT_DIR; // You control this — no need to rely on body param

	try {
		let filesToProcess = [];

		if (fs.statSync(inputPath).isDirectory()) {
			console.log(`🔍 Scanning directory: ${inputPath}`);
			filesToProcess = getApexFiles(inputPath);
		} else if (inputPath.endsWith(".cls")) {
			filesToProcess = [inputPath];
		} else {
			return res
				.status(400)
				.send({ error: "Path must be a folder or .cls file." });
		}

		if (filesToProcess.length === 0) {
			return res
				.status(400)
				.send({ error: "No Apex class files found." });
		}

		await processFiles(filesToProcess, OUTPUT_DIR, INPUT_DIR);
		res.send({ message: `✅ Processed ${filesToProcess.length} file(s).` });
	} catch (err) {
		console.error(err);
		res.status(500).send({ error: "Processing failed." });
	}
});

/** --- Zip Output Directory --- */
app.get("/download-zip", (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
	const archive = archiver("zip", { zlib: { level: 9 } });
	res.attachment("processed_output.zip");
	archive.pipe(res);
	archive.directory(OUTPUT_DIR, false);
	archive.finalize();
});

/** --- Cleanup Input Directory --- */
app.post("/cleanup-input", async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
	try {
		await fsExtra.emptyDir(INPUT_DIR);
        await fsExtra.emptyDir(OUTPUT_DIR);
		res.send({ message: "Input folder cleaned." });
	} catch (err) {
		console.error(err);
		res.status(500).send({ error: "Failed to clean input folder." });
	}
});


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

// Send a message to all listening clients
function sendLogToClients(message) {
	console._logOriginal("Sending data to client");
	console._logOriginal(message);
	const event = `data: ${message.replace(/\n/g, "")}\n\n`;
	for (const client of logClients) {
		client.write(event);
	}
}

function createLiveLogger() {
	return (msg) => {
		if (typeof msg !== "string") {
			msg = JSON.stringify(msg);
		}
		sendLogToClients(msg);
		console._logOriginal(msg); // optional: still print to console
	};
}

// Save the original
console._logOriginal = console.log;

// Overwrite global console.log with your live-aware version
console.log = createLiveLogger();

/** --- Serve Frontend (Optional) --- */
app.use(express.static(path.join(__dirname, "public"))); // if HTML is placed in /public

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
