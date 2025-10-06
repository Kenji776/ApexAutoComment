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
});

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
	const model = document.getElementById("modelSelect").value; // 🧠 new
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

	// collect variable values
	const variables = {};
	document.querySelectorAll(".var-input").forEach((el) => {
		if (el.value.trim() !== "") variables[el.id] = el.value.trim();
	});

	status.textContent = "🧩 Processing files...";
	const processResponse = await fetch(`/process?mode=${mode}`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ variables, model }), // 🧠 send model too
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

	status.textContent = "🧹 Cleaning up...";
	await fetch("/cleanup-input", { method: "POST" });

	status.textContent = "✅ Done!";
	stopLogStream();
}
