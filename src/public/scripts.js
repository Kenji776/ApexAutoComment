let eventSource = null;
let selectedFiles = []; // managed file list (File objects)
let tokenLocked = false; // true when daily limit is reached

// Check if we're simulating a remote user via URL param
const urlParams = new URLSearchParams(window.location.search);
const simulateRemote = urlParams.get("simulateRemote") === "true";

// ─── Token usage tracking ──────────────────────────────

function apiUrl(path) {
	if (simulateRemote && !path.includes("simulateRemote")) {
		const sep = path.includes("?") ? "&" : "?";
		return path + sep + "simulateRemote=true";
	}
	return path;
}

async function fetchTokenUsage() {
	try {
		const res = await fetch(apiUrl("/api/token-usage"));
		if (!res.ok) return null;
		return await res.json();
	} catch {
		return null;
	}
}

function formatTokenCount(n) {
	if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
	if (n >= 1000) return (n / 1000).toFixed(1) + "K";
	return String(n);
}

function updateTokenUsageUI(info) {
	if (!info) return;

	const bar = document.getElementById("tokenUsageFill");
	const count = document.getElementById("tokenUsageCount");
	const note = document.getElementById("tokenUsageNote");
	const lockout = document.getElementById("tokenLockout");
	const uploadBtn = document.getElementById("uploadBtn");

	if (info.unlimited) {
		bar.style.width = "0%";
		bar.className = "token-usage-fill";
		count.textContent = "Unlimited (localhost)";
		note.textContent = "";
		lockout.style.display = "none";
		tokenLocked = false;
		return;
	}

	const pct = Math.min(100, Math.floor((info.used / info.limit) * 100));
	bar.style.width = pct + "%";

	// Color tiers
	if (pct >= 90) {
		bar.className = "token-usage-fill critical";
	} else if (pct >= 70) {
		bar.className = "token-usage-fill warning";
	} else {
		bar.className = "token-usage-fill";
	}

	count.textContent = `${formatTokenCount(info.used)} / ${formatTokenCount(info.limit)}`;

	// Reset time
	if (info.resetsIn) {
		const hrs = Math.floor(info.resetsIn / 3600000);
		const mins = Math.floor((info.resetsIn % 3600000) / 60000);
		const tz = info.timezone || "server time";
		note.textContent = `Resets in ${hrs}h ${mins}m (midnight ${tz})`;
	}

	if (!info.allowed) {
		tokenLocked = true;
		lockout.style.display = "block";
		uploadBtn.disabled = true;
	} else {
		tokenLocked = false;
		lockout.style.display = "none";
	}
}

// ─── Spinner helpers ───────────────────────────────────

function showSpinner(text) {
	const area = document.getElementById("spinnerArea");
	const label = document.getElementById("spinnerText");
	area.style.display = "flex";
	label.textContent = text || "Processing...";
}

function hideSpinner() {
	document.getElementById("spinnerArea").style.display = "none";
}

// Track progress state for blended file + method progress
let progressState = {
	totalFiles: 0,
	completedFiles: 0,
	methodCurrent: 0,
	methodTotal: 0,
};

function resetProgressState() {
	progressState = {
		totalFiles: 0,
		completedFiles: 0,
		methodCurrent: 0,
		methodTotal: 0,
	};
}

function calcOverallPercent() {
	if (progressState.totalFiles === 0) return 0;
	const fileSlice = 100 / progressState.totalFiles;
	const completedPct = progressState.completedFiles * fileSlice;
	const methodPct = progressState.methodTotal > 0 ? (progressState.methodCurrent / progressState.methodTotal) * fileSlice : 0;
	return Math.min(Math.floor(completedPct + methodPct), 100);
}

function startLogStream() {
	const logDisplay = document.getElementById("log-output");
	logDisplay.innerText = "";
	eventSource = new EventSource("/logs");
	eventSource.onmessage = function(event) {
		const logBox = document.getElementById("log-output");
		const progressBar = document.getElementById("progressBar");
		const progressLabel = document.getElementById("progressLabel");
		progressLabel.style.display = "block";

		try {
			const msg = JSON.parse(event.data);
			if (msg.type === "progress") {
				progressState.totalFiles = msg.total;
				progressState.completedFiles = msg.current;
				progressState.methodCurrent = 0;
				progressState.methodTotal = 0;

				const pct = calcOverallPercent();
				progressBar.value = pct;
				progressLabel.textContent = `${msg.status} (file ${msg.current}/${msg.total}) — ${pct}%`;
			} else if (msg.type === "method_progress") {
				progressState.methodCurrent = msg.current;
				progressState.methodTotal = msg.total;

				const pct = calcOverallPercent();
				progressBar.value = pct;
				progressLabel.textContent = `${msg.file}: ${msg.status} (${msg.current + 1}/${msg.total}) — ${pct}%`;
			} else if (msg.type === "complete") {
				progressBar.style.display = "none";
				progressLabel.style.display = "none";
				hideSpinner();
			} else if (msg.type === "docs_generating" || msg.type === "packaging") {
				// Hide progress bar and status, show spinner
				progressBar.style.display = "none";
				progressLabel.style.display = "none";
				document.getElementById("status").textContent = "";
				showSpinner(msg.status);
			} else if (msg.type === "error") {
				progressBar.value = 0;
				progressLabel.textContent = "Error";
				hideSpinner();
				document.getElementById("status").textContent = "❌ Server error during processing.";
				logBox.textContent += `\n❌ ERROR: ${msg.status}\n`;
			} else {
				logBox.textContent += msg + "\n";
			}
		} catch {
			logBox.textContent += event.data + "\n";
		}
		logBox.scrollTop = logBox.scrollHeight;
	};
}

function stopLogStream() {
	if (eventSource) {
		eventSource.close();
		eventSource = null;
	}
}

document.addEventListener("DOMContentLoaded", async () => {
	buildPanels();
	document.getElementById("fileInput").addEventListener("change", onFilesSelected);
	const uploadBtn = document.getElementById("uploadBtn");
	uploadBtn.disabled = true;

	// Fetch and display token usage
	const info = await fetchTokenUsage();
	updateTokenUsageUI(info);
});

// ─── File selection & management ───────────────────────────

function getBaseName(fileName) {
	if (fileName.endsWith(".cls-meta.xml")) return fileName.replace(/\.cls-meta\.xml$/, "");
	if (fileName.endsWith(".cls")) return fileName.replace(/\.cls$/, "");
	return fileName;
}

function onFilesSelected() {
	const rawFiles = Array.from(document.getElementById("fileInput").files);
	selectedFiles = rawFiles.filter((f) => f.name.endsWith(".cls") || f.name.endsWith(".cls-meta.xml"));
	renderFileList();
	validateSelectedFiles();
}

function removeFilePair(baseName) {
	selectedFiles = selectedFiles.filter((f) => getBaseName(f.name) !== baseName);
	renderFileList();
	validateSelectedFiles();
}

function renderFileList() {
	const listEl = document.getElementById("filePanelList");
	const countEl = document.getElementById("filePanelCount");

	// Group by base name
	const pairs = {};
	for (const file of selectedFiles) {
		const base = getBaseName(file.name);
		if (!pairs[base]) pairs[base] = { cls: false, meta: false };
		if (file.name.endsWith(".cls-meta.xml")) {
			pairs[base].meta = true;
		} else if (file.name.endsWith(".cls")) {
			pairs[base].cls = true;
		}
	}

	const sortedBases = Object.keys(pairs).sort((a, b) => a.localeCompare(b));
	const pairCount = sortedBases.filter((b) => pairs[b].cls && pairs[b].meta).length;

	countEl.textContent = `${sortedBases.length} class${sortedBases.length !== 1 ? "es" : ""}`;

	if (sortedBases.length === 0) {
		listEl.innerHTML = '<div class="file-panel-empty">Select a folder to see files here</div>';
		return;
	}

	listEl.innerHTML = sortedBases
		.map((base) => {
			const p = pairs[base];
			const parts = [];
			if (p.cls) parts.push(".cls");
			if (p.meta) parts.push(".cls-meta.xml");
			const missing = !p.cls || !p.meta;
			const metaLabel = parts.join(" + ") + (missing ? " (missing pair!)" : "");

			return `
			<div class="file-pair-row">
				<div class="file-pair-info">
					<span class="file-pair-name" title="${base}">${base}</span>
					<span class="file-pair-meta${missing ? " missing" : ""}">${metaLabel}</span>
				</div>
				<button class="file-pair-remove" onclick="removeFilePair('${base.replace(/'/g, "\\'")}')" title="Remove this class pair">✕</button>
			</div>`;
		})
		.join("");
}

function validateSelectedFiles() {
	const uploadBtn = document.getElementById("uploadBtn");
	const status = document.getElementById("status");

	if (!selectedFiles.length) {
		status.textContent = "⚠️ Please select a folder containing Apex class files.";
		uploadBtn.disabled = true;
		return;
	}

	const clsFiles = new Set();
	const metaFiles = new Set();
	const invalidFiles = [];

	for (const file of selectedFiles) {
		const name = file.name;
		if (name.endsWith(".cls") && !name.endsWith(".cls-meta.xml")) {
			clsFiles.add(name.replace(/\.cls$/, ""));
		} else if (name.endsWith(".cls-meta.xml")) {
			metaFiles.add(name.replace(/\.cls-meta\.xml$/, ""));
		} else {
			invalidFiles.push(name);
		}
	}

	if (invalidFiles.length > 0) {
		status.textContent = "❌ Directory contains unsupported files.";
		uploadBtn.disabled = true;
		return;
	}

	const missingPairs = [];
	for (const base of clsFiles) {
		if (!metaFiles.has(base)) missingPairs.push(`${base}.cls-meta.xml`);
	}
	for (const base of metaFiles) {
		if (!clsFiles.has(base)) missingPairs.push(`${base}.cls`);
	}

	if (clsFiles.size === 0 && metaFiles.size === 0) {
		status.textContent = "⚠️ No Apex class files found.";
		uploadBtn.disabled = true;
		return;
	}

	if (missingPairs.length > 0) {
		status.textContent = `⚠️ ${missingPairs.length} file(s) missing their pair. Remove unpaired entries or re-select folder.`;
		uploadBtn.disabled = true;
		return;
	}

	status.textContent = `✅ Found ${clsFiles.size} valid Apex class pair${clsFiles.size > 1 ? "s" : ""}. Ready to upload.`;
	uploadBtn.disabled = tokenLocked;
}

// ─── Collapsible panels ────────────────────────────────────

function buildPanels() {
	document.querySelectorAll(".collapsible-header").forEach((header) => {
		const arrow = header.querySelector(".arrow");
		const panel = header.nextElementSibling;

		if (!panel || !panel.classList.contains("collapsible-panel")) return;

		header.addEventListener("click", () => {
			const isOpen = panel.classList.toggle("open");
			if (arrow) arrow.classList.toggle("open", isOpen);
		});
	});
}

// ─── Upload & process ──────────────────────────────────────

async function uploadAndProcess() {
	const uploadBtn = document.getElementById("uploadBtn");

	// Re-check token limit before starting
	const preCheck = await fetchTokenUsage();
	updateTokenUsageUI(preCheck);
	if (tokenLocked) {
		document.getElementById("status").textContent = "❌ Daily token limit reached.";
		return;
	}

	uploadBtn.disabled = true;
	resetProgressState();
	startLogStream();
	const mode = document.getElementById("modeSelect").value;
	const model = document.getElementById("modelSelect").value;
	const status = document.getElementById("status");
	const progressBar = document.getElementById("progressBar");
	const progressLabel = document.getElementById("progressLabel");

	progressBar.value = 0;
	progressBar.style.display = "";
	progressLabel.style.display = "block";
	progressLabel.textContent = "Uploading...";
	hideSpinner();

	if (!selectedFiles.length) {
		status.textContent = "⚠️ Please select some files.";
		uploadBtn.disabled = false;
		return;
	}

	const formData = new FormData();
	for (const file of selectedFiles) formData.append("files", file);

	status.textContent = "📤 Uploading files...";
	const uploadResponse = await fetch("/upload", { method: "POST", body: formData });

	if (!uploadResponse.ok) {
		status.textContent = "❌ File upload failed.";
		uploadBtn.disabled = false;
		stopLogStream();
		return;
	}

	const uploadData = await uploadResponse.json();
	const jobId = uploadData.jobId;
	console.log("Job ID:", jobId);

	const variables = {};
	document.querySelectorAll(".var-input").forEach((el) => {
		if (el.value.trim() !== "") variables[el.id] = el.value.trim();
	});

	status.textContent = "🧩 Processing files...";
	const processResponse = await fetch(apiUrl(`/process?mode=${mode}`), {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ variables, model, jobId }),
	});

	// Refresh token usage regardless of outcome
	const postInfo = await fetchTokenUsage();
	updateTokenUsageUI(postInfo);

	if (processResponse.status === 429) {
		status.textContent = "❌ Daily token limit reached. Please try again tomorrow.";
		hideSpinner();
		uploadBtn.disabled = false;
		stopLogStream();
		return;
	}

	if (!processResponse.ok) {
		status.textContent = "❌ Error during processing.";
		hideSpinner();
		uploadBtn.disabled = false;
		stopLogStream();
		return;
	}

	status.textContent = "📦 Downloading results...";
	const blob = await processResponse.blob();
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = "final_output.zip";
	document.body.appendChild(a);
	a.click();
	a.remove();

	status.textContent = "✅ All done! Your download should begin automatically.";
	hideSpinner();
	progressBar.style.display = "none";
	progressLabel.style.display = "none";
	uploadBtn.disabled = false;
	stopLogStream();
}
