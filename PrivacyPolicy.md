# Privacy Policy for Ozon Growth Agent

**Last Updated:** July 2026

Welcome to **Ozon Growth Agent**. We are committed to protecting your privacy and ensuring the security of your data. This Privacy Policy explains how this open-source Chrome extension handles your information.

## 1. Local Data Processing
Our extension is designed as a local agentic runtime. **We do not run our own servers to collect, process, or store your data.** 
All data processing, including reading webpage content (DOM) and capturing screenshots for analysis, occurs **locally on your device**.

## 2. Third-Party API Usage
To perform AI analysis, the extension sends the locally extracted webpage data (text and screenshots) directly to the third-party Large Language Model (LLM) API provider that **you** have configured in the extension settings (e.g., OpenAI, Anthropic, Alibaba Cloud/Qwen, SiliconFlow, Groq, or a custom API endpoint).
* We **do not** act as a middleman. 
* Your API keys are stored locally in your browser's `chrome.storage.local` and are never transmitted to us.
* Please review the privacy policy of your chosen API provider to understand how they handle the data sent to them.

## 3. Data We Do Not Collect
* We **do not** collect personal identification information (PII).
* We **do not** collect, track, or store your browsing history.
* We **do not** collect or store your API keys.
* We **do not** use analytics trackers to monitor your behavior.

## 4. Permissions Justification
To function correctly, the extension requires the following permissions:
* `activeTab` & `<all_urls>`: Required to read the DOM and capture screenshots of the active e-commerce page you wish to analyze. Data is only extracted when you explicitly click the "Run Skill" button.
* `storage`: Required to save your settings (e.g., API keys, preferred models), update status, local checkpoints, and analysis history locally on your device.
* `scripting`: Required to inject the content script that extracts structured data from the webpage.
* `alarms`: Required to run scheduled monitor tasks and periodic GitHub version checks.
* `tabs`: Required to open the dashboard, research pages, and controlled workflow tabs when you explicitly run a task.

## 5. Update Awareness
The extension may contact GitHub Releases or the public GitHub repository metadata to check whether a newer public version is available. This check sends standard network request metadata to GitHub, but it does not send your Ozon data, API keys, reports, or browsing history to us.

## 6. Changes to This Policy
We may update our Privacy Policy from time to time. Any changes will be reflected on this page with an updated revision date.

## 7. Contact Us
If you have any questions about this Privacy Policy or the open-source project, please open an issue in the GitHub repository: https://github.com/ninemouth/ozon-growth-agent
