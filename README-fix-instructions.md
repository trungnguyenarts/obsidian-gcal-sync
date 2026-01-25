The `obsidian-gcal-sync` plugin has been successfully built with the fix for the task parsing issue.

The unchecked task prefix (`- [ ] `) should no longer be synced to Google Calendar.

To verify the fix, please install the updated plugin in your Obsidian vault:
1. Locate the `main.js`, `manifest.json`, and `styles.css` files in the project root directory (t:\project\2026\obsidian-gcal-sync-main\).
2. Copy these files to your Obsidian vault's `.obsidian/plugins/obsidian-gcal-sync/` directory, overwriting the existing ones.
3. Restart Obsidian or disable/re-enable the plugin.
4. Test syncing an unchecked task to Google Calendar.

Please let me know if you encounter any further issues.