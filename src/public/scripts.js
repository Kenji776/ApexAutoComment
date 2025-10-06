let eventSource = null;

function startLogStream() {
	const logDisplay = document.getElementById("log-output");
	logDisplay.innerText = "";
	eventSource = new EventSource("/logs");
	eventSource.onmessage = function(event) {
		const logBox = document.getElementById("log-output");
		try {
			const msg = JSON.parse(event.data);
			if (msg.type === "progress") {
				const pct = Math.floor((msg.current / msg.total) * 100);
				document.getElementById("progressBar").value = pct;
				document.getElementById("progressLabel").textContent = `${msg.status} (${msg.current}/${msg.total})`;
			} else if (msg.type === "complete") {
				document.getElementById("progressBar").value = 100;
				document.getElementById("progressLabel").textContent = msg.status;
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

document.addEventListener("DOMContentLoaded", () => {
	buildPanels();
	document.getElementById("fileInput").addEventListener("change", validateFilePairs);
	const uploadBtn = document.getElementById("uploadBtn");
	uploadBtn.disabled = true; // ensure disabled on load
});

function validateFilePairs() {
	const files = Array.from(document.getElementById("fileInput").files);
	const uploadBtn = document.getElementById("uploadBtn");
	const status = document.getElementById("status");

	if (!files.length) {
		status.textContent = "⚠️ Please select a folder containing Apex class files.";
		uploadBtn.disabled = true;
		return;
	}

	// Separate into relevant sets
	const clsFiles = new Set();
	const metaFiles = new Set();
	const invalidFiles = [];

	for (const file of files) {
		const name = file.name;

		if (name.endsWith(".cls")) {
			const base = name.replace(/\.cls$/, "");
			clsFiles.add(base);
		} else if (name.endsWith(".cls-meta.xml")) {
			const base = name.replace(/\.cls-meta\.xml$/, "");
			metaFiles.add(base);
		} else {
			invalidFiles.push(name);
		}
	}

	// 🚫 Reject if any non-.cls or non-.cls-meta.xml file found
	if (invalidFiles.length > 0) {
		alert(`❌ Invalid files detected. Only .cls and .cls-meta.xml files are allowed.\n\nInvalid files:\n${invalidFiles.join("\n")}`);
		status.textContent = "❌ Directory contains unsupported files.";
		uploadBtn.disabled = true;
		return;
	}

	// 🔎 Verify pairing consistency
	const missingPairs = [];
	for (const base of clsFiles) {
		if (!metaFiles.has(base)) missingPairs.push(`${base}.cls-meta.xml`);
	}
	for (const base of metaFiles) {
		if (!clsFiles.has(base)) missingPairs.push(`${base}.cls`);
	}

	// 🚫 No valid pairs at all
	if (clsFiles.size === 0 && metaFiles.size === 0) {
		status.textContent = "⚠️ No Apex class files found.";
		uploadBtn.disabled = true;
		return;
	}

	// 🚫 Some pairs missing
	if (missingPairs.length > 0) {
		alert(`❌ The selected directory must contain paired files (.cls and .cls-meta.xml) with matching names.\nMissing counterparts:\n\n${missingPairs.join("\n")}`);
		status.textContent = "⚠️ Missing file pairs detected.";
		uploadBtn.disabled = true;
		return;
	}

	// ✅ All good
	status.textContent = `✅ Found ${clsFiles.size} valid Apex class pair${clsFiles.size > 1 ? "s" : ""}. Ready to upload.`;
	uploadBtn.disabled = false;
}

function buildPanels() {
	// Automatically find and wire all collapsible sections
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
async function uploadAndProcess() {
	startLogStream();
	const files = document.getElementById("fileInput").files;
	const mode = document.getElementById("modeSelect").value;
	const model = document.getElementById("modelSelect").value;
	const status = document.getElementById("status");

	if (!files.length) {
		status.textContent = "⚠️ Please select some files.";
		return;
	}

	const formData = new FormData();
	for (const file of files) formData.append("files", file);

	status.textContent = "📤 Uploading files...";
	const uploadResponse = await fetch("/upload", { method: "POST", body: formData });

	if (!uploadResponse.ok) {
		status.textContent = "❌ File upload failed.";
		stopLogStream();
		return;
	}

	const uploadData = await uploadResponse.json();
	const jobId = uploadData.jobId; // 🔑 store for processing step
	console.log("Job ID:", jobId);

	// collect variable values
	const variables = {};
	document.querySelectorAll(".var-input").forEach((el) => {
		if (el.value.trim() !== "") variables[el.id] = el.value.trim();
	});

	status.textContent = "🧩 Processing files...";
	const processResponse = await fetch(`/process?mode=${mode}`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ variables, model, jobId }), // ✅ now includes jobId
	});

	if (!processResponse.ok) {
		status.textContent = "❌ Error during processing.";
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

	status.textContent = "✅ Done!";
	stopLogStream();
}
