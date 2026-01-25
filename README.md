# Obsidian Google Calendar Sync (Trungnguyenarts Folk Edition)

## Overview

This is a specialized "Folk" version of the original [Obsidian Google Calendar Sync](https://github.com/sasoon/obsidian-gcal-sync) plugin. It is designed to bridge Obsidian Tasks and Google Calendar with enhanced features, smarter parsing, and better visual organization.

This edition includes several "quality of life" improvements developed to streamline the workflow for power users.

---

## ✨ Folk Edition Enhancements

Compared to the base version, this edition offers:

*   **Enhanced Task Parsing**:
    *   **Flexible Time Syntax**: Supports the standard `-` separator for time ranges (e.g., `⏰ 09:00 - 10:00`). 
    *   **Expanded Status Support**: Recognizes more task states like `/` (In Progress), `>` (Deferred), and `!` (Important).
*   **Smart Content Handling**:
    *   **Title/Description Split**: Use the `//` separator to keep your Google Calendar clean. Text before `//` becomes the event title; text after becomes the event description.
    *   **Multi-line Support**: Automatically includes indented lines below a task into the Google Calendar description.
*   **Visual & Performance Upgrades**:
    *   **Numerical Color IDs**: Set event colors using `🎨 #1` to `🎨 #11`. This avoids interference with Obsidian's tag system while allowing direct color control from your notes.
    *   **Title Metadata Cleaner**: Advanced filtering removes tags, IDs, reminders, and color codes from the Google Calendar title for a professional look.
    *   **Safe Sync & Performance**: Includes a **5-minute Grace Period** to prevent accidental deletions and optimized **Batch Processing** for a smooth mobile experience.

---

## 🚀 Installation

### Requirements
*   [Obsidian Tasks](https://github.com/obsidian-tasks-group/obsidian-tasks) (Recommended)

### Manual Installation
1.  Download the repository or the latest release.
2.  Copy `main.js`, `manifest.json`, and `styles.css` to your vault's `.obsidian/plugins/obsidian-gcal-sync/` directory.
3.  Enable the plugin in **Settings > Community Plugins**.

---

## 🔐 Authentication & Setup

The plugin uses **OAuth 2.0 with PKCE** for secure authentication. 

*   **Desktop**: Authenticates via a local web server (port 8085).
*   **Mobile**: Uses a secure Netlify landing page to handle the authentication flow.

*Note: The "Google hasn't verified this app" warning is expected; your tokens are stored locally and never shared.*

---

## 📝 Syntax & Usage

To sync a task, use the following standardized format:

`- [ ] 🔔 [Reminder] ⏰ [Time] [Summary] // [Detailed Description] #project 🎨 #[ColorID]`

### Date & Time Formats
*   `📅 YYYY-MM-DD`: Task date.
*   `⏰ HH:MM`: Start time.
*   `- HH:MM`: End time. (Use `-` for best compatibility with the Obsidian Calendar plugin's Timeline view).
*   `🔔 30m / 🔔 2h / 🔔 1d`: Reminder offset.

### Color Mapping (Numerical)
Use `🎨 #<1-11>` to match Google Calendar's default color palette (e.g., `🎨 #1` for Lavender, `🎨 #10` for Basil).

---

## 🛡️ Security & Privacy
*   **Local Storage**: All OAuth tokens and metadata stay within your vault.
*   **Direct API**: Communications happen directly between your device and Google APIs.
*   **No Tracking**: No external storage or tracking services are used.

## 🤝 Support & Credits
Building upon the great work by **Sasoon Sarkisian**. For the folk version details, refer to the project logs in the documentation.

---
*Developed and maintained by **trungnguyenarts** with help from **Em Thư Ký**.*
