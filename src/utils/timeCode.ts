const WEEKDAY_LABELS = ['星期一', '星期二', '星期三', '星期四', '星期五', '星期六', '星期日'];

export interface TimeSegment {
    weekType: 0 | 1 | 2;
    day: number;
    startSlot: number;
    endSlot: number;
}

export function parseTimeCode (code: string): TimeSegment | null {
    if (!code || code.length !== 4) return null;
    const weekType = parseInt(code.slice(0, 1), 10);
    const dayRaw = parseInt(code.slice(1, 2), 10);
    const startSlot = parseInt(code.slice(2, 3), 16);
    const endSlot = parseInt(code.slice(3, 4), 16);
    if (![0, 1, 2].includes(weekType)) return null;
    if (!Number.isFinite(dayRaw) || !Number.isFinite(startSlot) || !Number.isFinite(endSlot)) return null;
    const day = dayRaw === 0 ? 7 : dayRaw;
    if (day < 1 || day > 7) return null;
    if (startSlot < 1 || endSlot < startSlot) return null;
    return { weekType: weekType as 0 | 1 | 2, day, startSlot, endSlot };
}

export function toSlotKeys (code: string): string[] {
    const parsed = parseTimeCode(code);
    if (!parsed) return [];
    const weeks = parsed.weekType === 0 ? [1, 2] : [parsed.weekType];
    const keys: string[] = [];
    for (const week of weeks) {
        for (let slot = parsed.startSlot; slot <= parsed.endSlot; slot++) {
            const row = Math.floor((slot - 1) / 2);
            keys.push(`${week}-${parsed.day}-${row}`);
        }
    }
    return keys;
}

export function formatCourseTimes (timeCodes: string[], maxCount?: number): string[] {
    const unique = new Map<string, { day: number; start: number; end: number }>();
    for (const code of timeCodes || []) {
        const parsed = parseTimeCode(code);
        if (!parsed) continue;
        const key = `${parsed.day}-${parsed.startSlot}-${parsed.endSlot}`;
        if (!unique.has(key)) unique.set(key, { day: parsed.day, start: parsed.startSlot, end: parsed.endSlot });
    }

    const lines = Array.from(unique.values())
        .sort((a, b) => a.day - b.day || a.start - b.start || a.end - b.end)
        .map(item => `${WEEKDAY_LABELS[item.day - 1]} ${item.start}-${item.end}节`);

    if (!maxCount || lines.length <= maxCount) return lines;
    return [...lines.slice(0, maxCount), `+${lines.length - maxCount}`];
}
