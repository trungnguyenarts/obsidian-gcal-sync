export class TimeUtils {
    /**
     * Gets the timezone offset in the format +/-HH:mm
     */
    static getTimezoneOffset(): string {
        const date = new Date();
        const offset = -date.getTimezoneOffset();
        const hours = Math.floor(Math.abs(offset) / 60);
        const minutes = Math.abs(offset) % 60;
        return `${offset >= 0 ? '+' : '-'}${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
    }

    /**
     * Formats date and time with timezone for Google Calendar API
     */
    static formatDateTime(date: string, time: string, timezone: string): string {
        return `${date}T${time}:00${timezone}`;
    }

    /**
     * Checks if a date is valid
     */
    static isValidDate(date: string): boolean {
        const regex = /^\d{4}-\d{2}-\d{2}$/;
        if (!regex.test(date)) return false;

        const d = new Date(date);
        return d instanceof Date && !isNaN(d.getTime());
    }

    /**
     * Checks if a time is valid (24-hour format)
     */
    static isValidTime(time: string): boolean {
        const regex = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;
        return regex.test(time);
    }

    /**
     * Gets current date in YYYY-MM-DD format
     */
    static getCurrentDate(): string {
        const date = new Date();
        return date.toISOString().split('T')[0];
    }

    /**
     * Gets current time in HH:mm format
     */
    static getCurrentTime(): string {
        const date = new Date();
        return date.toTimeString().slice(0, 5);
    }

    /**
     * Checks if a target date is within a window around a center date
     * @param targetDateStr YYYY-MM-DD string
     * @param windowDays Number of days (+/-)
     * @param centerDate Optional center date (default: today)
     */
    static isDateInWindow(targetDateStr: string, windowDays: number, centerDate: Date = new Date()): boolean {
        if (!this.isValidDate(targetDateStr)) return false;

        const target = new Date(targetDateStr);
        // Reset times to compare dates only
        target.setHours(0, 0, 0, 0);
        const start = new Date(centerDate);
        start.setHours(0, 0, 0, 0);
        start.setDate(start.getDate() - windowDays);

        const end = new Date(centerDate);
        end.setHours(0, 0, 0, 0);
        end.setDate(end.getDate() + windowDays);

        return target >= start && target <= end;
    }
} 