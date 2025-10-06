// themes/themeManager.js
(function() {
	const defaultTheme = "markdown8.css";
	const themeKey = "apexDocsTheme"; // still used if you ever host it

	function log(msg) {
		console.log(`[ThemeManager] ${msg}`);
	}

	function computePrefix() {
		const afterHtml = window.location.pathname.split("/html/")[1] || "";
		const depth = afterHtml.split("/").length - 1;
		return "../".repeat(depth);
	}

	function applyTheme(themeFile) {
		const prefix = computePrefix();
		let link = document.getElementById("_theme");
		if (!link) {
			link = document.createElement("link");
			link.rel = "stylesheet";
			link.id = "_theme";
			document.head.appendChild(link);
		}
		link.href = prefix + "themes/" + themeFile;
		log(`Applied theme: ${themeFile}`);
	}

	function getThemeFromURL() {
		const hashMatch = location.hash.match(/theme=([^&]+)/);
		const queryMatch = location.search.match(/theme=([^&]+)/);
		const theme = hashMatch ? hashMatch[1] : queryMatch ? queryMatch[1] : null;
		if (theme) log(`Theme from URL: ${theme}`);
		return theme;
	}

	function getStoredTheme() {
		try {
			const val = localStorage.getItem(themeKey);
			if (val) return val;
		} catch {}
		return null;
	}

	function setStoredTheme(val) {
		try {
			localStorage.setItem(themeKey, val);
		} catch {}
	}

	function updateLinks(theme) {
		const links = document.querySelectorAll("a[href]");
		links.forEach((link) => {
			const href = link.getAttribute("href");
			if (!href || href.startsWith("#") || href.startsWith("http")) return;

			// remove existing theme hash or query
			let newHref = href.replace(/[#?]theme=[^&]+/, "");
			// append correct delimiter
			const hasHash = newHref.includes("#");
			const hasQuery = newHref.includes("?");
			const delimiter = hasHash ? "&" : hasQuery ? "&" : "#";
			newHref += `${delimiter}theme=${theme}`;
			link.setAttribute("href", newHref);
		});
		log(`Updated ${links.length} links with theme=${theme}`);
	}

	function bindThemeSelect() {
		const select = document.getElementById("theme_select");
		if (!select) return;

		const themeFromUrl = getThemeFromURL();
		const savedTheme = themeFromUrl || getStoredTheme() || defaultTheme;

		applyTheme(savedTheme);
		select.value = savedTheme;

		// Update all links on load
		updateLinks(savedTheme);

		select.addEventListener("change", () => {
			const chosen = select.value;
			applyTheme(chosen);
			setStoredTheme(chosen);
			updateLinks(chosen);

			// update our own URL so refreshing keeps it
			const newHash = `#theme=${chosen}`;
			if (!location.hash.includes(newHash)) {
				history.replaceState(null, "", newHash);
			}
		});
	}

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", bindThemeSelect);
	} else {
		bindThemeSelect();
	}

	log("Theme manager initialized");
})();
