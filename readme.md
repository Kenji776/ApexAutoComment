# Apex AutoCommenter

Automatically generate class-level and method-level Javadoc-style comment blocks for Salesforce Apex code using OpenAI's GPT models.

## 🚀 Overview

**Apex AutoCommenter** is a Node.js-based utility that scans Apex `.cls` files, analyzes their class and method structure, and generates intelligent Javadoc-style comments using ChatGPT (via OpenAI's API). It includes a sleek web interface for uploading `.cls` files and downloading annotated versions in bulk.

---

## ✨ Features

- 📁 Upload Apex `.cls` files or folders via a modern browser UI
- 🤖 Uses OpenAI’s GPT-4o model to generate meaningful comment blocks
- 🧠 Includes dependency context awareness for better comment accuracy
- 🧱 Supports both class-level and method-level documentation
- 📦 Downloads results as a single zip archive
- 📊 Real-time progress bar and log stream via Server-Sent Events

---

## 🖥️ Local Setup

### 1. **Clone the Repository**

```bash
git clone https://github.com/your-username/apex-autocommenter.git
cd apex-autocommenter
```

### 2. **Install Dependencies**

```bash
npm install
```

### 3. **Environment Configuration**

Create a `.env` file in the project root:

```env
OPENAI_API_KEY=your-openai-api-key
```

### 4. **Start the App**

```bash
node src/server.js
```

Visit [http://localhost:3000](http://localhost:3000) in your browser.

---

## 🧠 How It Works

1. User uploads `.cls` files using the frontend
2. Files are stored in the `input/` directory
3. `processor.js` reads each file, extracts its classes and methods
4. It uses `dependencyResolver.js` to gather context
5. Prompts are crafted and sent to OpenAI to generate comments
6. A new annotated file is saved in `output/`
7. All results are zipped and made available for download

---

## 📁 Project Structure

```
apex-autocommenter/
├── input/                ← Uploaded Apex files
├── output/               ← Processed Apex files with comments
├── public/               ← Frontend HTML/CSS/JS
├── src/
│   ├── server.js         ← Express server & API endpoints
│   ├── processor.js      ← File processing logic
│   ├── fileScanner.js    ← Scans and collects Apex files
│   ├── functionExtractor.js ← Extracts methods and class blocks
│   └── dependencyResolver.js ← Pulls class/method context
├── .env
├── package.json
└── README.md
```

---

## 🧪 Example Output

Given a simple method:

```apex
public void doSomething(Integer value) {
    // logic here
}
```

It will generate a block like:

```apex
/**
 * @description Performs an action based on the provided value.
 * @param value The input value used to control execution.
 */
public void doSomething(Integer value) {
    // logic here
}
```

---

## 🔐 OpenAI API Notes

You’ll need your own [OpenAI API Key](https://platform.openai.com/account/api-keys). The system uses the `gpt-4o` model by default. API usage costs may apply.

---

## 📦 Future Improvements

- Fine-grained control over model temperature and prompt tuning
- Authentication for multi-user access
- VSCode plugin for inline commenting
- Support for other languages like Java or TypeScript

---

## 🧑‍💻 Author

**Kenji (Daniel Llewellyn)**  
_“Godspeed and keep your guard up, kid.”_

---

## 🪪 License

This project is licensed under the MIT License.