import { App, PluginSettingTab, Setting } from 'obsidian';
import type GoogleCalendarSync from './main';
import { GoogleCalendarSettings } from './types';
import { useStore } from './store';
import { Notice } from 'obsidian';

export const DEFAULT_SETTINGS: GoogleCalendarSettings = {
    clientId: '',
    oauth2Tokens: undefined,
    syncEnabled: true,
    defaultReminder: 30,
    includeFolders: ['calendar/daily/2025-02-27'],  // Empty by default to scan all folders
    taskMetadata: {},
    taskIds: {},
    verboseLogging: true,  // Default to false for new users
    hasCompletedOnboarding: true,  // Set to true to prevent welcome modal on startup
    mobileSyncLimit: 100,  // Default to 100 files on mobile
    mobileOptimizations: true,  // Enable mobile optimizations by default
    deletionGracePeriodMs: 300000, // 5 minutes default grace period before deleting orphaned events
    customClientId: '',
    customClientSecret: '',
    calendarId: 'primary',
    secretICalAddress: '',
    syncWindowDays: 7,
    syncWindowEnabled: true,
};

export class GoogleCalendarSettingsTab extends PluginSettingTab {
    plugin: GoogleCalendarSync;

    constructor(app: App, plugin: GoogleCalendarSync) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        containerEl.createEl('h2', { text: 'Google Calendar Sync Settings' });

        // Sync Settings Section
        containerEl.createEl('h3', { text: 'Sync Settings' });

        new Setting(containerEl)
            .setName('Auto-sync')
            .setDesc('Automatically sync tasks when they are created or modified')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.syncEnabled)
                .onChange(async (value) => {
                    this.plugin.settings.syncEnabled = value;
                    useStore.getState().setSyncEnabled(value);
                    await this.plugin.saveSettings();
                    this.plugin.updateStatusBar();
                    new Notice(`Auto-sync ${value ? 'enabled' : 'disabled'}`);
                }));

        new Setting(containerEl)
            .setName('Folders to Sync')
            .setDesc('Specify folders to scan for tasks. One folder per line. Leave empty to scan all folders.')
            .addTextArea(text => text
                .setPlaceholder('folder1\nfolder2/subfolder')
                .setValue(this.plugin.settings.includeFolders.join('\n'))
                .onChange(async (value) => {
                    this.plugin.settings.includeFolders = value
                        .split('\n')
                        .map(folder => folder.trim())
                        .filter(folder => folder.length > 0);
                    await this.plugin.saveSettings();
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Sync Window')
            .setDesc('Only sync tasks within a specific window of days around today.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.syncWindowEnabled ?? true)
                .onChange(async (value) => {
                    this.plugin.settings.syncWindowEnabled = value;
                    await this.plugin.saveSettings();
                    // Force refresh of views if needed?
                }));

        new Setting(containerEl)
            .setName('Sync Window Range (+/- Days)')
            .setDesc('Number of days before and after today to include in frequent syncs (default: 7). This prevents syncing your entire history every time.')
            .addText(text => text
                .setPlaceholder('7')
                .setValue((this.plugin.settings.syncWindowDays ?? 7).toString())
                .onChange(async (value) => {
                    const days = parseInt(value);
                    if (!isNaN(days) && days >= 0) {
                        this.plugin.settings.syncWindowDays = days;
                        await this.plugin.saveSettings();
                    }
                }));

        // Calendar Settings Section
        containerEl.createEl('h3', { text: 'Calendar Settings' });

        new Setting(containerEl)
            .setName('Default Reminder')
            .setDesc('Default reminder time in minutes before the task (if no specific reminder is set)')
            .addText(text => text
                .setPlaceholder('30')
                .setValue(this.plugin.settings.defaultReminder.toString())
                .onChange(async (value) => {
                    const reminder = parseInt(value);
                    if (!isNaN(reminder) && reminder >= 0) {
                        this.plugin.settings.defaultReminder = reminder;
                        await this.plugin.saveSettings();
                    }
                }));

        new Setting(containerEl)
            .setName('Verbose Logging')
            .setDesc('Enable detailed debug logging (useful for troubleshooting)')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.verboseLogging)
                .onChange(async (value) => {
                    this.plugin.settings.verboseLogging = value;
                    await this.plugin.saveSettings();
                }));

        // Mobile Settings Section
        containerEl.createEl('h3', { text: 'Mobile Optimizations' });

        new Setting(containerEl)
            .setName('Enable Mobile Optimizations')
            .setDesc('Apply mobile-specific optimizations for better performance on mobile devices')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.mobileOptimizations ?? true)
                .onChange(async (value) => {
                    this.plugin.settings.mobileOptimizations = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Mobile Sync File Limit')
            .setDesc('Maximum number of files to scan for tasks on mobile devices (lower values improve performance)')
            .addText(text => text
                .setPlaceholder('100')
                .setValue((this.plugin.settings.mobileSyncLimit ?? 100).toString())
                .onChange(async (value) => {
                    const limit = parseInt(value);
                    if (!isNaN(limit) && limit > 0) {
                        this.plugin.settings.mobileSyncLimit = limit;
                        await this.plugin.saveSettings();
                    }
                }));

        new Setting(containerEl)
            .setName('Deletion Grace Period (ms)')
            .setDesc('How long (in milliseconds) a task remains marked for pending deletion before its Google Calendar event is actually removed. Default is 5 minutes (300000 ms).')
            .addText(text => text
                .setPlaceholder('300000')
                .setValue((this.plugin.settings.deletionGracePeriodMs ?? 300000).toString())
                .onChange(async (value) => {
                    const gracePeriod = parseInt(value);
                    if (!isNaN(gracePeriod) && gracePeriod >= 0) {
                        this.plugin.settings.deletionGracePeriodMs = gracePeriod;
                        await this.plugin.saveSettings();
                    }
                }));

        // Advanced Settings Section: Custom OAuth
        containerEl.createEl('h3', { text: 'Custom OAuth Credentials (Advanced)' });

        const oauthDesc = containerEl.createDiv();
        oauthDesc.createEl('p', { text: 'If you\'re seeing "This app is blocked" errors, you can use your own Google Cloud OAuth credentials:' });
        const list = oauthDesc.createEl('ol');
        list.createEl('li', { text: 'Go to ' }).createEl('a', { text: 'Google Cloud Console', href: 'https://console.cloud.google.com/' });
        list.createEl('li', { text: 'Create a new project (or select existing)' });
        list.createEl('li', { text: 'Enable the Google Calendar API' });
        list.createEl('li', { text: 'Go to "Credentials" → "Create Credentials" → "OAuth client ID"' });
        list.createEl('li', { text: 'Choose "Desktop app" as the application type' });
        list.createEl('li', { text: 'Copy the Client ID and Client Secret below' });
        list.createEl('li', { text: 'Add http://127.0.0.1:8085/callback to Authorized redirect URIs' });

        const note = oauthDesc.createEl('p', { text: 'Note: After changing credentials, disconnect and reconnect your Google account.' });
        note.style.color = 'var(--text-error)';
        note.style.fontWeight = 'bold';

        new Setting(containerEl)
            .setName('Custom Client ID')
            .setDesc('Your Google OAuth Client ID (leave empty to use default)')
            .addText(text => text
                .setPlaceholder('Enter your custom client ID')
                .setValue(this.plugin.settings.customClientId || '')
                .onChange(async (value) => {
                    this.plugin.settings.customClientId = value.trim();
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Custom Client Secret')
            .setDesc('Your Google OAuth Client Secret (leave empty to use default)')
            .addText(text => text
                .setPlaceholder('Enter your custom client secret')
                .setValue(this.plugin.settings.customClientSecret || '')
                .onChange(async (value) => {
                    this.plugin.settings.customClientSecret = value.trim();
                    await this.plugin.saveSettings();
                }));

        // Advanced Settings Section: Calendar Connection
        containerEl.createEl('h3', { text: 'Calendar Connection (Advanced)' });

        new Setting(containerEl)
            .setName('Google Calendar ID')
            .setDesc('Default is "primary". Change this if you want to sync with a specific calendar or if you see connection errors.')
            .addText(text => text
                .setPlaceholder('e.g. primary or your-calendar-id@group.calendar.google.com')
                .setValue(this.plugin.settings.calendarId || 'primary')
                .onChange(async (value) => {
                    this.plugin.settings.calendarId = value.trim() || 'primary';
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Secret iCal Address')
            .setDesc('The "Secret address in iCal format" from Google Calendar settings. This will be used for enhanced two-way sync features.')
            .addText(text => text
                .setPlaceholder('https://calendar.google.com/calendar/ical/...')
                .setValue(this.plugin.settings.secretICalAddress || '')
                .onChange(async (value) => {
                    this.plugin.settings.secretICalAddress = value.trim();
                    await this.plugin.saveSettings();
                }));
    }
}