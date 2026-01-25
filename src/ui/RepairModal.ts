import { App, Modal, Setting, Notice } from 'obsidian';
import type GoogleCalendarSyncPlugin from '../core/main';
import type { Task } from '../core/types';
import { LogUtils } from '../utils/logUtils';

export class RepairModal extends Modal {
    private tasks: Map<string, Task> = new Map();
    private isScanning = false;

    constructor(app: App, private plugin: GoogleCalendarSyncPlugin) {
        super(app);
    }

    async onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h2', { text: 'Repair & Sync Tasks' });

        const statusDiv = contentEl.createDiv({ cls: 'gcal-repair-status' });
        statusDiv.setText('Scanning vault for tasks... please wait.');

        const listContainer = contentEl.createDiv({ cls: 'gcal-task-list-container' });
        listContainer.style.maxHeight = '300px';
        listContainer.style.overflowY = 'auto';
        listContainer.style.border = '1px solid var(--background-modifier-border)';
        listContainer.style.padding = '10px';
        listContainer.style.marginTop = '10px';
        listContainer.style.display = 'none';

        try {
            this.isScanning = true;
            if (this.plugin.repairManager) {
                this.tasks = await this.plugin.repairManager.getAllTasks();
            }
            this.isScanning = false;

            // Update UI
            statusDiv.setText(`Found ${this.tasks.size} tasks in configured folders.`);
            listContainer.style.display = 'block';

            // Render list
            const tasksArray = Array.from(this.tasks.values()).sort((a, b) => {
                return (a.date || '').localeCompare(b.date || '');
            });

            tasksArray.forEach(task => {
                const item = listContainer.createDiv({ cls: 'gcal-task-item' });
                item.style.display = 'flex';
                item.style.justifyContent = 'space-between';
                item.style.padding = '4px 0';
                item.style.borderBottom = '1px solid var(--background-modifier-border)';

                const info = item.createSpan();
                info.setText(`${task.date || 'No Date'} ${task.status === ' ' ? '[ ]' : '[x]'} ${task.title}`);
                info.style.overflow = 'hidden';
                info.style.textOverflow = 'ellipsis';
                info.style.whiteSpace = 'nowrap';
                info.style.marginRight = '10px';
            });

            // Action buttons
            const buttonContainer = contentEl.createDiv({ cls: 'gcal-modal-buttons' });
            buttonContainer.style.display = 'flex';
            buttonContainer.style.justifyContent = 'flex-end';
            buttonContainer.style.marginTop = '20px';
            buttonContainer.style.gap = '10px';

            const cancelButton = buttonContainer.createEl('button', { text: 'Cancel' });
            cancelButton.onclick = () => this.close();

            const confirmButton = buttonContainer.createEl('button', { cls: 'mod-cta', text: 'Confirm Repair & Resync All' });
            confirmButton.onclick = async () => {
                this.close();
                new Notice('Starting full repair synchronization...');
                if (this.plugin.repairManager) {
                    await this.plugin.repairManager.repairSyncState((progress) => {
                        // Optional: Could emit events to update status bar
                        LogUtils.debug(`Repair progress: ${progress.phase} - ${progress.currentOperation}`);
                    });
                    new Notice('Repair synchronization completed.');
                }
            };

        } catch (error) {
            statusDiv.setText(`Error scanning tasks: ${error}`);
            LogUtils.error('Repair scan failed', error);
        }
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
