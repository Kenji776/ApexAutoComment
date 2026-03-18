const fs = require("fs");
const path = require("path");
const Anthropic = require("@anthropic-ai/sdk");
const cliProgress = require("cli-progress");
require("dotenv").config();

const BASE_DIR = path.resolve(__dirname); // always /src
const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
const promptPath = path.join(BASE_DIR, "prompt.txt");
const systemPrompt = fs.readFileSync(promptPath, "utf-8");
const { resolveDependencies } = require("./dependencyResolver");
const { extractFunctions, extractClassBlock } = require("./functionExtractor");

let llmPromptVars = {};
let llmModel = "claude-sonnet-4-20250514";
let jobTokensUsed = 0;

const ALERT_URL = "http://172-232-10-86.ip.linodeusercontent.com/ds_network_alerts";

async function sendAlert(message) {
	try {
		await fetch(ALERT_URL, {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: String(message),
		});
	} catch (err) {
		console.error("Failed to send alert:", err.message);
	}
}

const multibar = new cliProgress.MultiBar(
	{
		clearOnComplete: false,
		hideCursor: true,
		format: "{bar} | {percentage}% | {value}/{total} | {status}",
	},
	cliProgress.Presets.shades_classic,
);

async function processFiles(filePaths, outputDir = "./output", inputDir, llmPromptVariables = {}, model = "claude-sonnet-4-20250514") {
	if (llmPromptVariables) llmPromptVars = llmPromptVariables;
	if (model) llmModel = model;
	jobTokensUsed = 0;
	const fileBar = multibar.create(filePaths.length, 0, {
		status: "Starting...",
	});

	for (let i = 0; i < filePaths.length; i++) {
		const file = filePaths[i];
		console.log(
			JSON.stringify({
				type: "progress",
				current: i,
				total: filePaths.length,
				status: `Processing ${path.basename(file)}`,
			}),
		);

		const elementBar = multibar.create(1, 0, { element: "" });
		fileBar.update({ status: `Processing ${path.basename(file)}` });

		await processFile(file, outputDir, inputDir, elementBar);
		fileBar.increment(1, { status: `Completed ${path.basename(file)}` });
		elementBar.stop();
		console.log(
			JSON.stringify({
				type: "progress",
				current: i + 1,
				total: filePaths.length,
				status: `Completed ${path.basename(file)}`,
			}),
		);
	}

	fileBar.stop();
	multibar.stop();

	console.log(
		JSON.stringify({
			type: "complete",
			status: "🎉 All files processed.",
		}),
	);

	return { tokensUsed: jobTokensUsed };
}

async function generateJavadocForClass(classContent, inputDir) {
	const dependencies = resolveDependencies(classContent, inputDir);
	const context = dependencies.join("\n");

	const prompt = [
		context,
		"\n\n--- TARGET CLASS BEGINS ---\n",
		classContent,
		"\n--- TARGET CLASS ENDS ---\n\n",
		"Please generate a Javadoc-style comment block that summarizes this Apex class. Do not rewrite the class. Only output the comment block. If you encounter any @ tags besides @description, @param, or @return do not modify them. Those 3 listed are the only properties you should regenerate. Do NOT wrap the output in markdown code fences or backticks — output the raw comment block only, starting with /** and ending with */.",
	].join("");

	const response = await anthropic.messages.create({
		model: llmModel,
		max_tokens: 4096,
		system: preprocessLLMPrompt(systemPrompt, llmPromptVars),
		messages: [{ role: "user", content: prompt }],
		temperature: 0.2,
	});

	jobTokensUsed += (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0);

	return stripCodeFences(response.content[0].text);
}

function preprocessLLMPrompt(prompt, variables = {}) {
	if (typeof prompt !== "string") return "";

	return prompt.replace(/\{([A-Za-z0-9_]+)\}/g, (match, key) => {
		// If the variable exists in the map, use it; otherwise leave it untouched
		return key in variables ? String(variables[key]) : match;
	});
}

/**
 * Strips markdown code fences from LLM output.
 * Handles ```java, ```apex, ```, and any other language tags.
 */
function stripCodeFences(text) {
	return text
		.replace(/^```[\w]*\s*\n?/gm, "")
		.replace(/^```\s*$/gm, "")
		.trim();
}

async function generateJavadocForMethod(methodContent, inputDir) {
	const dependencies = resolveDependencies(methodContent, inputDir);
	const context = dependencies.join("\n");

	const promptContent = `${context}\n\nNow generate a Javadoc-style comment block ONLY for the following Apex method. Do not output the method itself, only the comment content. Do not include any leading tabs or spaces, I will handle the formatting. Do NOT wrap the output in markdown code fences or backticks — output the raw comment block only, starting with /** and ending with */:\n\n--- TARGET METHOD BEGINS ---\n${methodContent}\n--- TARGET METHOD ENDS ---`;

	const messages = [{ role: "user", content: promptContent }];

	const response = await anthropic.messages.create({
		model: llmModel,
		max_tokens: 4096,
		system: preprocessLLMPrompt(systemPrompt, llmPromptVars),
		messages,
		temperature: 0.2,
	});

	jobTokensUsed += (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0);

	const replyContent = response.content[0].text;

	fs.appendFileSync(
		path.join(process.cwd(), "javadoc-generation.log"),
		[`=== REQUEST: ${methodContent} (${new Date().toISOString()}) ===`, promptContent, `=== RESPONSE: ${methodContent} (${new Date().toISOString()}) ===`, replyContent, "\n\n"].join("\n"),
		"utf-8",
	);

	return stripCodeFences(replyContent);
}

async function processFile(filePath, outputDir = "./output", inputDir = path.dirname(filePath), elementBar) {
	const fileContent = fs.readFileSync(filePath, "utf-8");
	const originalLines = fileContent.split("\n");

	const classBlock = extractClassBlock(fileContent);
	const functionBlocks = extractFunctions(fileContent);

	elementBar.setTotal(functionBlocks.length);
	elementBar.update(0, { element: "" });

	const processedFunctions = [];
	for (let i = 0; i < functionBlocks.length; i++) {
		const func = functionBlocks[i];

		elementBar.update(i + 1, { status: `Element: ${func.methodName}` });

		console.log(
			JSON.stringify({
				type: "method_progress",
				file: path.basename(filePath),
				current: i,
				total: functionBlocks.length + 1, // +1 for class-level comment
				status: `Commenting method: ${func.methodName}`,
			}),
		);

		const leadingWhitespace = func.declarationBlock.match(/^\s*/)?.[0] ?? "";

		const comment = await generateJavadocForMethod(func.declarationBlock + "\n" + func.bodyContent, inputDir);
		const commentBlock = formatCommentBlock(comment, leadingWhitespace);

		processedFunctions.push([commentBlock, func.declarationBlock, func.bodyContent].join("\n\n"));
	}

	const cleanedHeaderLines = stripLeadingCommentBlock(originalLines, classBlock.startLine);
	const beforeClass = cleanedHeaderLines.join("\n");

	const classBodyRebuild = [classBlock.declarationBlock, ...processedFunctions, "}"].join("\n\n");

	console.log(
		JSON.stringify({
			type: "method_progress",
			file: path.basename(filePath),
			current: functionBlocks.length,
			total: functionBlocks.length + 1,
			status: `Generating class-level comment`,
		}),
	);

	const classComment = await generateJavadocForClass(classBodyRebuild, inputDir);
	const classCommentBlock = formatCommentBlock(classComment);

	const rebuiltFile = [beforeClass.trim(), classCommentBlock, classBlock.declarationBlock, ...processedFunctions, "}"].join("\n\n");

	if (!fs.existsSync(outputDir)) {
		fs.mkdirSync(outputDir, { recursive: true });
	}

	const outputPath = path.join(outputDir, path.basename(filePath));
	fs.writeFileSync(outputPath, rebuiltFile, "utf-8");
}

function formatCommentBlock(comment, indent = "") {
	return comment
		.split("\n")
		.map((line) => indent + line)
		.join("\n");
}

function stripLeadingCommentBlock(lines, classStartLine) {
	let firstCodeLine = 0;
	let insideBlockComment = false;

	for (let i = 0; i < classStartLine; i++) {
		const trimmed = lines[i].trim();

		if (trimmed.startsWith("/**")) {
			insideBlockComment = true;
			continue;
		}

		if (insideBlockComment && trimmed.endsWith("*/")) {
			insideBlockComment = false;
			continue;
		}

		if (!insideBlockComment && !trimmed.startsWith("//") && trimmed !== "") {
			firstCodeLine = i;
			break;
		}
	}

	return lines.slice(0, firstCodeLine);
}

module.exports = { processFile, processFiles, sendAlert };
