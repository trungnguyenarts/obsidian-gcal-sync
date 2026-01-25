import { App, Modal, Setting, Notice } from 'obsidian';
import type GoogleCalendarSyncPlugin from '../core/main';
import { TimeUtils } from '../utils/timeUtils';
import { LogUtils } from '../utils/logUtils';

export class SyncDateModal extends Modal {
    private selectedDate: string = TimeUtils.getCurrentDate();

    constructor(app: App, private plugin: GoogleCalendarSyncPlugin) {
        super(app);
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h2', { text: 'Sync Specific Date' });

        new Setting(contentEl)
            .setName('Select Date')
            .setDesc('Choose the date to sync tasks for.')
            .addText(text => {
                text.inputEl.type = 'date';
                text.setValue(this.selectedDate);
                text.onChange(value => {
                    this.selectedDate = value;
                });
            });

        const buttonContainer = contentEl.createDiv({ cls: 'gcal-modal-buttons' });
        buttonContainer.style.display = 'flex';
        buttonContainer.style.justifyContent = 'flex-end';
        buttonContainer.style.marginTop = '20px';
        buttonContainer.style.gap = '10px';

        const cancelButton = buttonContainer.createEl('button', { text: 'Cancel' });
        cancelButton.onclick = () => this.close();

        const confirmButton = buttonContainer.createEl('button', { cls: 'mod-cta', text: 'Sync Date' });
        confirmButton.onclick = async () => {
            if (!this.selectedDate) {
                new Notice('Please select a date.');
                return;
            }
            this.close();
            await this.syncSpecificDate(this.selectedDate);
        };
    }

    private async syncSpecificDate(date: string) {
        new Notice(`Syncing tasks for ${date}...`);
        try {
            if (this.plugin.repairManager) {
                const files = await this.plugin.repairManager.getMarkdownFiles();
                let taskCount = 0;

                // Process files
                for (const file of files) {
                    // CRITICAL: suppressEnqueue prevents the parser from auto-enqueueing tasks
                    const tasks = await this.plugin.taskParser.parseTasksFromFile(file, { suppressEnqueue: true });
                    const tasksForDate = tasks.filter(t => t.id && t.date === date);

                    if (tasksForDate.length > 0) {
                        taskCount += tasksForDate.length;
                        await this.plugin.store.getState().enqueueTasks(tasksForDate);
                    }
                }

                if (taskCount > 0) {
                    await this.plugin.store.getState().processSyncQueueNow();
                    new Notice(`Synced ${taskCount} tasks for ${date}.`);
                } else {
                    new Notice(`No tasks found for ${date}.`);
                }
            }
        } catch (error) {
            LogUtils.error(`Error syncing date ${date}:`, error);
            new Notice('Error occurred while syncing date. Check logs.');
        }
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
