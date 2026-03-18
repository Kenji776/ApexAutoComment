// tokenTracker.js — Per-IP daily token usage tracker
const fs = require("fs");
const path = require("path");

const USAGE_FILE = path.join(process.cwd(), "token-usage.json");
const DAILY_LIMIT = parseInt(process.env.DAILY_TOKEN_LIMIT, 10) || 500000;
const RESET_TIMEZONE = process.env.RESET_TIMEZONE || "America/Chicago";
const LOCALHOST_IPS = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

// In-memory store: { [ip]: { date: 'YYYY-MM-DD', tokens: number } }
let usage = {};

/**
 * Returns today's date string (YYYY-MM-DD) in the configured timezone.
 */
function getToday() {
	const parts = new Intl.DateTimeFormat("en-CA", {
		timeZone: RESET_TIMEZONE,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).formatToParts(new Date());

	const y = parts.find((p) => p.type === "year").value;
	const m = parts.find((p) => p.type === "month").value;
	const d = parts.find((p) => p.type === "day").value;
	return `${y}-${m}-${d}`;
}

/**
 * Returns milliseconds until midnight in the configured timezone.
 */
function getMillisUntilReset() {
	const now = new Date();

	// Get current hours/minutes/seconds in the configured timezone
	const fmt = new Intl.DateTimeFormat("en-US", {
		timeZone: RESET_TIMEZONE,
		hour: "numeric",
		minute: "numeric",
		second: "numeric",
		hour12: false,
	}).formatToParts(now);

	const h = parseInt(fmt.find((p) => p.type === "hour").value, 10);
	const min = parseInt(fmt.find((p) => p.type === "minute").value, 10);
	const s = parseInt(fmt.find((p) => p.type === "second").value, 10);

	const elapsedMs = (h * 3600 + min * 60 + s) * 1000;
	const dayMs = 24 * 60 * 60 * 1000;

	return dayMs - elapsedMs;
}

/**
 * Loads usage data from disk. Called once at startup.
 */
function load() {
	try {
		if (fs.existsSync(USAGE_FILE)) {
			usage = JSON.parse(fs.readFileSync(USAGE_FILE, "utf-8"));
		}
	} catch (err) {
		console.error("Failed to load token usage file:", err.message);
		usage = {};
	}
}

/**
 * Persists current usage data to disk.
 */
function save() {
	try {
		fs.writeFileSync(USAGE_FILE, JSON.stringify(usage, null, 2), "utf-8");
	} catch (err) {
		console.error("Failed to save token usage file:", err.message);
	}
}

/**
 * Checks if the given IP is a localhost address.
 */
function isLocalhost(ip) {
	return LOCALHOST_IPS.has(ip);
}

/**
 * Normalizes an IP address for consistent tracking.
 * Strips IPv6-mapped IPv4 prefix if present.
 */
function normalizeIp(ip) {
	if (ip && ip.startsWith("::ffff:") && ip !== "::ffff:127.0.0.1") {
		return ip.slice(7);
	}
	return ip;
}

/**
 * Returns the current token count for an IP, resetting if it's a new day.
 */
function getTokensUsed(ip) {
	ip = normalizeIp(ip);
	const today = getToday();
	const entry = usage[ip];
	if (!entry || entry.date !== today) return 0;
	return entry.tokens;
}

/**
 * Adds tokens to an IP's daily tally.
 */
function addTokens(ip, count) {
	ip = normalizeIp(ip);
	const today = getToday();

	if (!usage[ip] || usage[ip].date !== today) {
		usage[ip] = { date: today, tokens: 0 };
	}

	usage[ip].tokens += count;
	save();
}

/**
 * Checks whether an IP is allowed to make more requests.
 * Localhost is always allowed.
 */
function isAllowed(ip) {
	ip = normalizeIp(ip);
	if (isLocalhost(ip)) return true;
	return getTokensUsed(ip) < DAILY_LIMIT;
}

/**
 * Returns a client-friendly usage info object for a given IP.
 */
function getInfo(ip) {
	ip = normalizeIp(ip);
	const unlimited = isLocalhost(ip);
	const used = getTokensUsed(ip);
	const limit = DAILY_LIMIT;
	const resetMs = getMillisUntilReset();

	return {
		used,
		limit,
		remaining: unlimited ? Infinity : Math.max(0, limit - used),
		unlimited,
		allowed: unlimited || used < limit,
		resetsIn: resetMs,
		timezone: RESET_TIMEZONE,
	};
}

/**
 * Prunes entries older than today to keep the file clean.
 */
function prune() {
	const today = getToday();
	let pruned = false;
	for (const ip of Object.keys(usage)) {
		if (usage[ip].date !== today) {
			delete usage[ip];
			pruned = true;
		}
	}
	if (pruned) save();
}

// Load on require and prune stale entries
load();
prune();

// Prune stale entries every hour
setInterval(prune, 60 * 60 * 1000);

module.exports = {
	addTokens,
	getTokensUsed,
	isAllowed,
	isLocalhost,
	getInfo,
	normalizeIp,
	DAILY_LIMIT,
};
