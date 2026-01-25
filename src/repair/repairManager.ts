import type GoogleCalendarSyncPlugin from '../core/main';
import { Task } from '../core/types';
import {
    RepairProgress,
    GoogleCalendarEvent,
    RepairResult,
    RepairError,
    TaskLockedError,
    CatastrophicError,
    RepairOperations,
    RepairPhases,
    RepairPhase
} from './types';
import { LogUtils } from '../utils/logUtils';
import { useStore } from '../core/store';
import { TFile } from 'obsidian';
import type { TaskStore } from '../core/store';

interface ProgressInfo {
    phase: RepairPhase;
    processedItems: number;
    totalItems: number;
    currentOperation: string;
    failedItems: string[];
    retryCount: number;
    currentBatch: number;
    errors: Array<{ id: string; error: string }>;
}

type ProgressCallback = (progress: ProgressInfo) => void;

export class RepairManager {
    private store: TaskStore;
    private readonly MIN_BATCH_SIZE = 5;
    private readonly MAX_BATCH_SIZE = 25;
    private readonly TARGET_BATCH_COUNT = 20;
    private readonly MAX_RETRIES = 3;
    private readonly RETRY_DELAY = 1000;

    constructor(private plugin: GoogleCalendarSyncPlugin) {
        this.store = useStore.getState();
    }

    private calculateOptimalBatchSize(totalTasks: number): number {
        return Math.max(
            this.MIN_BATCH_SIZE,
            Math.min(
                this.MAX_BATCH_SIZE,
                Math.ceil(totalTasks / this.TARGET_BATCH_COUNT)
            )
        );
    }

    private async withTaskLock<T>(taskId: string, operation: () => Promise<T>): Promise<T> {
        const store = useStore.getState();
        if (store.isTaskLocked(taskId)) {
            throw new TaskLockedError(taskId);
        }

        store.addProcessingTask(taskId);
        try {
            return await operation();
        } finally {
            store.removeProcessingTask(taskId);
        }
    }

    private async retryOperation<T>(
        operation: () => Promise<T>,
        taskId: string,
        maxRetries: number = this.MAX_RETRIES
    ): Promise<T> {
        let lastError: Error | undefined;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                return await operation();
            } catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));
                if (attempt < maxRetries) {
                    await new Promise(resolve => setTimeout(resolve, this.RETRY_DELAY * attempt));
                    LogUtils.debug(`Retrying operation for task ${taskId}, attempt ${attempt + 1}/${maxRetries}`);
                }
            }
        }

        throw new RepairError(
            `Failed after ${maxRetries} attempts: ${lastError?.message}`,
            taskId
        );
    }

    public async repairSyncState(onProgress?: ProgressCallback): Promise<RepairResult> {
        const startTime = Date.now();
        const errors: Map<string, Error> = new Map();
        const processed: Set<string> = new Set();
        const taskIds = new Set<string>();

        try {
            // Get initial state
            const tasks = await this.getAllTasks();
            tasks.forEach(task => task.id && taskIds.add(task.id));

            onProgress?.({
                phase: RepairPhases.init,
                processedItems: 0,
                totalItems: tasks.size,
                currentOperation: RepairOperations.INIT,
                failedItems: [],
                retryCount: 0,
                currentBatch: 0,
                errors: []
            });

            // Cleanup phase
            const calendarEvents = await this.plugin.calendarSync?.findAllObsidianEvents() || [];
            const obsidianEvents = calendarEvents;  // No need to filter since findAllObsidianEvents already returns only Obsidian tasks

            // Clean up orphaned events and metadata first
            const updateProgress = (progress: Partial<ProgressInfo>, phase: RepairPhase, operation: string) => {
                onProgress?.({
                    ...progress,
                    phase,
                    currentOperation: operation,
                    failedItems: progress.failedItems || [],
                    retryCount: progress.retryCount || 0,
                    currentBatch: progress.currentBatch || 0,
                    errors: progress.errors || [],
                    processedItems: progress.processedItems || 0,
                    totalItems: progress.totalItems || 0
                });
            };

            await this.deleteOrphanedEvents(calendarEvents, taskIds, (progress) => {
                updateProgress(progress, RepairPhases.delete, RepairOperations.CLEANUP_EVENTS);
            });

            await this.cleanupOrphanedMetadata(taskIds, (progress) => {
                updateProgress(progress, RepairPhases.metadata, RepairOperations.CLEANUP_METADATA);
            });

            // Enhanced Sync phase - more robust rebuilding of events
            if (tasks.size > 0) {
                const store = useStore.getState();
                store.startSync();
                store.enableTempSync();

                try {
                    // Clear existing queue
                    store.clearSyncQueue();
                    const taskArray = Array.from(tasks.values());

                    // Group tasks into those with existing events and those without
                    const tasksWithEvents: Task[] = [];
                    const tasksWithoutEvents: Task[] = [];

                    // Build a lookup map of task IDs to calendar events
                    const eventsByTaskId = new Map<string, GoogleCalendarEvent>();
                    calendarEvents.forEach(event => {
                        const taskId = event.extendedProperties?.private?.obsidianTaskId;
                        if (taskId) {
                            // Only store the most recent event for each task
                            const existing = eventsByTaskId.get(taskId);
                            if (!existing || new Date(event.updated || 0) > new Date(existing.updated || 0)) {
                                eventsByTaskId.set(taskId, event);
                            }
                        }
                    });

                    // Group tasks based on whether they have calendar events and completion status
                    const tasksToDelete: Task[] = [];

                    taskArray.forEach(task => {
                        if (!task.id) return;

                        // If task is completed, queue it for sync to update with ✅
                        if (task.completed) {
                            // Enqueue for update, not deletion
                            if (this.plugin.calendarSync) {
                                // Use the syncTask logic to update the completed task
                                store.enqueueTasks([task]);
                                LogUtils.debug(`Task ${task.id} is completed, enqueued for update with ✅`);
                            }
                        } else {
                            // Not completed, normal event handling
                            if (eventsByTaskId.has(task.id)) {
                                tasksWithEvents.push(task);
                            } else {
                                tasksWithoutEvents.push(task);
                                LogUtils.debug(`Task ${task.id} missing calendar event, will recreate`);
                            }
                        }
                    });



                    // Next, explicitly create events for tasks without them
                    let processedCount = 0;
                    const batchSize = this.calculateOptimalBatchSize(tasksWithoutEvents.length);
                    const totalBatches = Math.ceil(tasksWithoutEvents.length / batchSize);

                    LogUtils.debug(`Creating events for ${tasksWithoutEvents.length} tasks without events (${totalBatches} batches of ~${batchSize})`);

                    for (let i = 0; i < tasksWithoutEvents.length; i += batchSize) {
                        const batch = tasksWithoutEvents.slice(i, i + batchSize);
                        const batchNum = Math.floor(i / batchSize) + 1;

                        const results = await Promise.allSettled(
                            batch.map(async (task) => {
                                if (!task.id) return;

                                try {
                                    // Force create new event
                                    if (this.plugin.calendarSync) {
                                        const eventId = await this.plugin.calendarSync.createEvent(task);
                                        processed.add(task.id);
                                        return { taskId: task.id, eventId, success: true };
                                    }
                                } catch (error) {
                                    errors.set(task.id, error instanceof Error ? error : new Error(String(error)));
                                    return { taskId: task.id, success: false, error };
                                }
                            })
                        );

                        processedCount += batch.length;

                        onProgress?.({
                            phase: 'create',
                            processedItems: processedCount,
                            totalItems: tasksWithoutEvents.length,
                            currentOperation: 'Creating missing events',
                            failedItems: Array.from(errors.keys()),
                            retryCount: 0,
                            currentBatch: batchNum,
                            errors: Array.from(errors.entries()).map(([id, error]) => ({
                                id,
                                error: error.message
                            }))
                        });

                        // Small delay between batches
                        if (i + batchSize < tasksWithoutEvents.length) {
                            await new Promise(resolve => setTimeout(resolve, 200));
                        }
                    }

                    // Then use the regular sync mechanism for tasks with existing events
                    if (tasksWithEvents.length > 0) {
                        LogUtils.debug(`Updating ${tasksWithEvents.length} tasks with existing events`);

                        // Add tasks to queue and process
                        await store.enqueueTasks(tasksWithEvents);
                        await store.processSyncQueueNow();

                        // Track processed tasks and errors
                        tasksWithEvents.forEach(task => {
                            if (task.id) {
                                const failedSync = store.failedSyncs.get(task.id);
                                if (failedSync) {
                                    errors.set(task.id, failedSync.error);
                                } else {
                                    processed.add(task.id);
                                }
                            }
                        });
                    }

                    onProgress?.({
                        phase: 'update',
                        processedItems: processed.size,
                        totalItems: tasks.size,
                        currentOperation: 'Processing tasks',
                        failedItems: Array.from(errors.keys()),
                        retryCount: 0,
                        currentBatch: 1,
                        errors: Array.from(errors.entries()).map(([id, error]) => ({
                            id,
                            error: error.message
                        }))
                    });
                } finally {
                    store.disableTempSync();
                    store.endSync(errors.size === 0);
                }
            } else {
                LogUtils.debug('No tasks found to repair. This is unusual - check if tasks have IDs.');
            }

            // Verify final state
            const finalEvents = await this.plugin.calendarSync?.listEvents() || [];
            const finalObsidianEvents = finalEvents.filter(event =>
                event.extendedProperties?.private?.isObsidianTask === 'true'
            );

            LogUtils.debug(`Repair completed. Events: ${finalObsidianEvents.length}, Processed: ${processed.size}, Errors: ${errors.size}`);

            return {
                success: errors.size === 0,
                processedCount: processed.size,
                errors,
                skippedTasks: new Set([...taskIds].filter(id => !processed.has(id))),
                timestamp: Date.now(),
                duration: Date.now() - startTime
            };

        } catch (error) {
            const catastrophicError = new CatastrophicError(
                `Catastrophic repair failure: ${error.message}`,
                'unknown'
            );

            return {
                success: false,
                processedCount: processed.size,
                errors: new Map([['global', catastrophicError]]),
                skippedTasks: new Set(taskIds),
                timestamp: Date.now(),
                duration: Date.now() - startTime
            };
        }
    }

    public async deleteOrphanedEvents(
        calendarEvents: GoogleCalendarEvent[],
        activeTaskIds: Set<string>,
        progressCallback?: (progress: RepairProgress) => void
    ): Promise<void> {
        try {
            LogUtils.debug('Starting orphaned events cleanup');
            let processedItems = 0;
            const totalItems = calendarEvents.length;

            // Group events by task ID for efficient lookup
            const eventsByTaskId = new Map<string, GoogleCalendarEvent[]>();
            for (const event of calendarEvents) {
                const taskId = event.extendedProperties?.private?.obsidianTaskId;
                if (taskId) {
                    const events = eventsByTaskId.get(taskId) || [];
                    events.push(event);
                    eventsByTaskId.set(taskId, events);
                }
            }

            // Process each task ID
            for (const [taskId, events] of eventsByTaskId) {
                try {
                    const taskMetadata = this.plugin.settings.taskMetadata[taskId];
                    const gracePeriodMs = this.plugin.settings.deletionGracePeriodMs ?? 300000; // Default to 5 minutes

                    if (activeTaskIds.has(taskId)) {
                        // Task found, clear pending deletion status if any
                        if (taskMetadata?.pendingDeletionTimestamp) {
                            LogUtils.debug(`Task ${taskId} found, clearing pending deletion status.`);
                            taskMetadata.pendingDeletionTimestamp = undefined;
                            await this.plugin.saveSettings();
                        }
                        // Move duplicate event handling here, as it only applies to active tasks
                        if (events.length > 1) {
                            // If multiple events exist for same task, keep only the most recent
                            const sortedEvents = events.sort((a, b) =>
                                (new Date(b.updated || 0)).getTime() - (new Date(a.updated || 0)).getTime()
                            );

                            // Delete all but the most recent event
                            for (let i = 1; i < sortedEvents.length; i++) {
                                try {
                                    await this.plugin.calendarSync?.deleteEvent(sortedEvents[i].id, taskId);
                                    LogUtils.debug(`Deleted duplicate event ${sortedEvents[i].id} for task ${taskId}`);
                                } catch (error) {
                                    LogUtils.error(`Failed to delete duplicate event ${sortedEvents[i].id}:`, error);
                                }
                            }

                            // Update metadata to point to the most recent event
                            const updatedMetadata = this.plugin.settings.taskMetadata[taskId]; // Re-fetch in case it was just cleared
                            if (updatedMetadata) {
                                this.plugin.settings.taskMetadata[taskId] = {
                                    ...updatedMetadata,
                                    eventId: sortedEvents[0].id
                                };
                                await this.plugin.saveSettings();
                            }
                        }
                    } else {
                        // Task not found in activeTaskIds, consider for pending deletion or actual deletion
                        if (taskMetadata) { // Only process if metadata exists for this taskId
                            if (!taskMetadata.pendingDeletionTimestamp) {
                                // First time this task is observed as missing, mark for pending deletion
                                LogUtils.debug(`Task ${taskId} not found. Marking for pending deletion.`);
                                taskMetadata.pendingDeletionTimestamp = Date.now();
                                await this.plugin.saveSettings();
                            } else {
                                // Task has been missing before, check grace period
                                const timeSincePending = Date.now() - taskMetadata.pendingDeletionTimestamp;
                                if (timeSincePending >= gracePeriodMs) {
                                    // Grace period expired, proceed with deletion
                                    LogUtils.debug(`Task ${taskId} still not found after grace period of ${gracePeriodMs}ms. Deleting ${events.length} events.`);
                                    for (const event of events) {
                                        try {
                                            await this.plugin.calendarSync?.deleteEvent(event.id, taskId);
                                            LogUtils.debug(`Deleted orphaned event ${event.id} for task ${taskId}`);
                                        } catch (error) {
                                            LogUtils.error(`Failed to delete orphaned event ${event.id}:`, error);
                                        }
                                    }
                                    // Clean up metadata
                                    delete this.plugin.settings.taskMetadata[taskId];
                                    await this.plugin.saveSettings();
                                } else {
                                    // Still within grace period
                                    LogUtils.debug(`Task ${taskId} still not found, but within grace period. Pending deletion for ${Math.round((gracePeriodMs - timeSincePending) / 1000)}s.`);
                                }
                            }
                        } else {
                            // This case should ideally not happen if a calendar event exists but no metadata,
                            // but as a fallback, if there's no metadata, and the task isn't active, delete the events.
                            LogUtils.warn(`No metadata found for task ${taskId} (associated with calendar events). Deleting events immediately.`);
                            for (const event of events) {
                                try {
                                    await this.plugin.calendarSync?.deleteEvent(event.id, taskId);
                                    LogUtils.debug(`Deleted orphaned event ${event.id} for task ${taskId} due to no metadata.`);
                                } catch (error) {
                                    LogUtils.error(`Failed to delete orphaned event ${event.id} due to no metadata:`, error);
                                }
                            }
                        }
                    }
                    processedItems += events.length;
                    if (progressCallback) {
                        progressCallback({
                            phase: RepairPhases.delete,
                            processedItems,
                            totalItems,
                            currentOperation: RepairOperations.CLEANUP_EVENTS,
                            failedItems: [],
                            retryCount: 0,
                            currentBatch: 0,
                            errors: []
                        });
                    }
                } catch (error) {
                    LogUtils.error(`Failed to process events for task ${taskId}:`, error);
                }
            } // This curly brace now correctly closes the 'for' loop body

            LogUtils.debug('Completed orphaned events cleanup');
        } catch (error) {
            LogUtils.error('Failed to cleanup orphaned events:', error);
            throw error;
        }
    }

    public async cleanupOrphanedMetadata(
        activeTaskIds: Set<string>,
        progressCallback?: (progress: RepairProgress) => void
    ): Promise<void> {
        try {
            LogUtils.debug(`Starting orphaned metadata cleanup. Active task IDs received: ${activeTaskIds.size}`);
            const metadata = this.plugin.settings.taskMetadata;
            const initialMetadataCount = Object.keys(metadata).length;
            LogUtils.debug(`Initial metadata entries: ${initialMetadataCount}`);
            let processedItems = 0;
            let deletionCandidates = 0;
            let actualDeletions = 0;

            for (const [taskId, taskMetadata] of Object.entries(metadata)) {
                try {
                    const gracePeriodMs = this.plugin.settings.deletionGracePeriodMs ?? 300000; // Default 5 minutes

                    if (activeTaskIds.has(taskId)) {
                        // Task found, clear pending deletion status if any
                        if (taskMetadata.pendingDeletionTimestamp) {
                            LogUtils.debug(`Metadata for task ${taskId} found (was pending deletion), clearing pending deletion status.`);
                            taskMetadata.pendingDeletionTimestamp = undefined;
                            await this.plugin.saveSettings();
                        }
                    } else {
                        // Task not found in activeTaskIds
                        LogUtils.debug(`Metadata for task ${taskId} is not in activeTaskIds.`);
                        deletionCandidates++;
                        if (!taskMetadata.pendingDeletionTimestamp) {
                            // First time this metadata is observed as orphaned, mark for pending deletion
                            LogUtils.debug(`Metadata for task ${taskId} orphaned. Marking for pending deletion. Event ID: ${taskMetadata.eventId || 'N/A'}`);
                            taskMetadata.pendingDeletionTimestamp = Date.now();
                            await this.plugin.saveSettings();
                        } else {
                            // Metadata has been orphaned before, check grace period
                            const timeSincePending = Date.now() - taskMetadata.pendingDeletionTimestamp;
                            if (timeSincePending >= gracePeriodMs) {
                                // Grace period expired, proceed with deletion
                                LogUtils.warn(`Metadata for task ${taskId} still orphaned after grace period of ${gracePeriodMs}ms. Deleting metadata and associated event. Event ID: ${taskMetadata.eventId || 'N/A'}`);
                                actualDeletions++;
                                // If event still exists, delete it first
                                if (taskMetadata.eventId) {
                                    try {
                                        await this.plugin.calendarSync?.deleteEvent(taskMetadata.eventId, taskId);
                                        LogUtils.debug(`Deleted orphaned event ${taskMetadata.eventId} for task ${taskId}`);
                                    } catch (error) {
                                        LogUtils.error(`Failed to delete orphaned event ${taskMetadata.eventId}:`, error);
                                    }
                                }

                                // Delete metadata
                                delete metadata[taskId];
                                LogUtils.debug(`Deleted orphaned metadata for task ${taskId}`);
                            } else {
                                // Still within grace period
                                LogUtils.debug(`Metadata for task ${taskId} still orphaned, but within grace period. Pending deletion for ${Math.round((gracePeriodMs - timeSincePending) / 1000)}s. Event ID: ${taskMetadata.eventId || 'N/A'}`);
                            }
                        }
                    }

                    processedItems++;
                    if (progressCallback) {
                        progressCallback({
                            phase: RepairPhases.metadata,
                            processedItems,
                            totalItems: initialMetadataCount, // Use initial count for total
                            currentOperation: RepairOperations.CLEANUP_METADATA,
                            failedItems: [],
                            retryCount: 0,
                            currentBatch: 0,
                            errors: []
                        });
                    }
                } catch (error) {
                    LogUtils.error(`Failed to process metadata for task ${taskId}:`, error);
                }
            }

            await this.plugin.saveSettings();
            LogUtils.debug(`Completed orphaned metadata cleanup. Processed ${processedItems} metadata entries, ${deletionCandidates} deletion candidates, ${actualDeletions} actual deletions.`);
        } catch (error) {
            LogUtils.error('Failed to cleanup orphaned metadata:', error);
            throw error;
        }
    }

    public async getAllTasks(): Promise<Map<string, Task>> {
        const tasks = new Map<string, Task>();
        const files = await this.getMarkdownFiles();

        LogUtils.debug(`Searching for tasks in ${files.length} markdown files`);

        // Force clear the file cache to ensure we get fresh content
        const state = useStore.getState();

        // Process files in batches to avoid overwhelming the system
        const BATCH_SIZE = 20;
        for (let i = 0; i < files.length; i += BATCH_SIZE) {
            const batch = files.slice(i, i + BATCH_SIZE);

            // Process each file in the batch
            for (const file of batch) {
                try {
                    // Force cache invalidation for every file
                    state.invalidateFileCache(file.path);

                    // Small delay to allow for filesystem operations
                    await new Promise(resolve => setTimeout(resolve, 20));

                    // Parse tasks from this file
                    const fileTasks = await this.plugin.taskParser.parseTasksFromFile(file, { suppressEnqueue: true });

                    // Add tasks with IDs to our collection
                    for (const task of fileTasks) {
                        if (task.id) {
                            tasks.set(task.id, task);
                        }
                    }

                    if (fileTasks.length > 0) {
                        LogUtils.debug(`Found ${fileTasks.length} tasks in ${file.path}`);
                    }
                } catch (error) {
                    LogUtils.error(`Error parsing tasks from ${file.path}:`, error);
                }
            }

            // Small delay between batches
            if (i + BATCH_SIZE < files.length) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }

        LogUtils.debug(`Found a total of ${tasks.size} tasks with IDs across all files`);
        return tasks;
    }

    private async cleanupOrphanedEvent(eventId: string, taskId: string): Promise<void> {
        try {
            await this.plugin.calendarSync?.deleteEvent(eventId);
            if (this.plugin.settings.taskMetadata[taskId]) {
                delete this.plugin.settings.taskMetadata[taskId];
                await this.plugin.saveSettings();
            }
            LogUtils.debug(`Deleted orphaned event ${eventId} for task ${taskId}`);
        } catch (error) {
            LogUtils.error(`Failed to delete orphaned event ${eventId}:`, error);
            throw error;
        }
    }

    public async getMarkdownFiles(): Promise<TFile[]> {
        // Get all markdown files in the vault
        const allFiles = this.plugin.app.vault.getMarkdownFiles();
        LogUtils.debug(`Found ${allFiles.length} total markdown files in vault`);

        // Log the include folder settings
        const includeSettings = this.plugin.settings.includeFolders || [];
        LogUtils.debug(`Folder inclusion settings: ${includeSettings.length > 0 ? JSON.stringify(includeSettings) : 'None (all files included)'}`);

        // If no include settings specified, return all markdown files
        if (!includeSettings.length) {
            LogUtils.debug(`Using all ${allFiles.length} markdown files for task search`);
            return allFiles;
        }

        // Create result array for matched files
        const matchedFiles: TFile[] = [];

        // Process each inclusion path
        for (const includePath of includeSettings) {
            // Check if this is a direct file reference (not ending with /)
            const isLikelyFile = !includePath.endsWith('/') && includePath.includes('.');

            if (isLikelyFile) {
                // Try to get this specific file
                const exactFile = allFiles.find(file => file.path === includePath);
                if (exactFile) {
                    LogUtils.debug(`Found exact file match: ${includePath}`);
                    matchedFiles.push(exactFile);
                    continue;
                }
            }

            // Handle as folder (strict matching with trailing slash)
            const folderMatchedFiles = allFiles.filter(file =>
                file.path === includePath || file.path.startsWith(includePath + '/')
            );

            if (folderMatchedFiles.length > 0) {
                LogUtils.debug(`Found ${folderMatchedFiles.length} files in folder: ${includePath}`);
                matchedFiles.push(...folderMatchedFiles);
                continue;
            }

            // Try lenient folder matching (without trailing slash)
            const folderNoSlash = includePath.endsWith('/') ? includePath.slice(0, -1) : includePath;
            const lenientMatches = allFiles.filter(file =>
                file.path === folderNoSlash || file.path.startsWith(folderNoSlash + '/')
            );

            if (lenientMatches.length > 0) {
                LogUtils.debug(`Found ${lenientMatches.length} files with lenient matching for: ${includePath}`);
                matchedFiles.push(...lenientMatches);
            }
        }

        // Remove duplicates
        const uniqueFiles = Array.from(new Set(matchedFiles.map(file => file.path)))
            .map(path => allFiles.find(file => file.path === path))
            .filter((file): file is TFile => file !== undefined);

        LogUtils.debug(`After filtering: ${uniqueFiles.length} markdown files match inclusion settings`);

        // If no files found after all approaches, use all files with a warning
        if (uniqueFiles.length === 0) {
            LogUtils.warn(`WARNING: No files match your folder inclusion settings. ` +
                `Using all vault files as a fallback for repair. ` +
                `Check your folder inclusion settings in the plugin settings.`);
            return allFiles;
        }

        return uniqueFiles;
    }
} 