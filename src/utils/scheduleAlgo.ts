import type { Course, CourseBundle, ArrangeScheduleResult, IncompatibleCourseGroup, IncompatibilityReason } from '@/types';
import { toSlotKeys } from '@/utils/timeCode';

export const TIME_SLOTS = [
    '第一、二节 (8:00-9:50)',
    '第三、四节 (10:20-12:10)',
    '第五、六节 (14:00-15:50)',
    '第七、八节 (16:20-18:10)',
    '第九、十节 (19:00-20:50)',
    '第十一节 (21:00-21:50)'
];

export const WEEK_DAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

function isExperiment (course: Course, selectedMap: Map<string, Course>): boolean {
    const last = course.id.charAt(course.id.length - 1);
    if (last >= '0' && last <= '9') return false;
    return selectedMap.has(course.id.slice(0, -1));
}

function courseSlotKeys (course: Course): string[] {
    const keys = new Set<string>();
    for (const t of course.time || []) {
        for (const key of toSlotKeys(t)) keys.add(key);
    }
    return [...keys];
}

function bundleSlotKeys (bundle: CourseBundle): Set<string> {
    const keys = new Set<string>();
    bundle.forEach(c => courseSlotKeys(c).forEach(k => keys.add(k)));
    return keys;
}

function hasSetConflict (a: Set<string>, b: Set<string>): boolean {
    for (const k of a) if (b.has(k)) return true;
    return false;
}

function capacityScore (schedule: CourseBundle[]): { over: number; pressure: number } {
    let over = 0;
    let pressure = 0;
    schedule.forEach(bundle => {
        bundle.forEach(course => {
            if (typeof course.yxzrs !== 'number' || typeof course.bksrl !== 'number' || (course.bksrl ?? 0) <= 0) return;
            const enrolled = course.yxzrs || 0;
            const cap = course.bksrl || 0;
            if (enrolled > cap) over += enrolled - cap;
            const ratio = cap > 0 ? enrolled / cap : 0;
            if (ratio >= 0.9) pressure += ratio;
        });
    });
    return { over, pressure };
}

function getReason (bundles: CourseBundle[], used: Set<string>, blocked: Set<string>): IncompatibilityReason {
    let hasBlocked = false;
    let hasConflict = false;
    for (const bundle of bundles) {
        const keys = bundleSlotKeys(bundle);
        if (hasSetConflict(keys, blocked)) hasBlocked = true;
        if (hasSetConflict(keys, used)) hasConflict = true;
    }
    if (hasBlocked && hasConflict) return 'mixed';
    if (hasBlocked) return 'blocked_time';
    return 'time_conflict';
}

function analyzeIncompatible (schedule: CourseBundle[], bundlesByName: Record<string, CourseBundle[]>, blocked: Set<string>): IncompatibleCourseGroup[] {
    const used = new Set<string>();
    schedule.forEach(bundle => bundle.forEach(c => courseSlotKeys(c).forEach(k => used.add(k))));
    const pickedNames = new Set(schedule.map(bundle => bundle[0]?.kcmc).filter(Boolean) as string[]);
    const results: IncompatibleCourseGroup[] = [];
    Object.entries(bundlesByName).forEach(([name, bundles]) => {
        if (pickedNames.has(name)) return;
        results.push({
            name,
            ids: [...new Set(bundles.flat().map(c => c.id))],
            reason: getReason(bundles, used, blocked)
        });
    });
    return results;
}

function rankTopConflicts (bundlesByName: Record<string, CourseBundle[]>, blocked: Set<string>): IncompatibleCourseGroup[] {
    const names = Object.keys(bundlesByName);
    const hints: IncompatibleCourseGroup[] = [];
    for (const name of names) {
        const bundles = bundlesByName[name] || [];
        let hardConflictCount = 0;
        for (const otherName of names) {
            if (otherName === name) continue;
            const otherBundles = bundlesByName[otherName] || [];
            let compatible = false;
            for (const b1 of bundles) {
                const k1 = bundleSlotKeys(b1);
                if (hasSetConflict(k1, blocked)) continue;
                for (const b2 of otherBundles) {
                    const k2 = bundleSlotKeys(b2);
                    if (hasSetConflict(k2, blocked)) continue;
                    if (!hasSetConflict(k1, k2)) {
                        compatible = true;
                        break;
                    }
                }
                if (compatible) break;
            }
            if (!compatible) hardConflictCount += 1;
        }
        const blockedOnly = bundles.every(b => hasSetConflict(bundleSlotKeys(b), blocked));
        if (hardConflictCount > 0 || blockedOnly) {
            hints.push({
                name,
                ids: [...new Set(bundles.flat().map(c => c.id))],
                reason: blockedOnly ? 'blocked_time' : 'time_conflict'
            });
        }
    }
    return hints.sort((a, b) => b.ids.length - a.ids.length).slice(0, 5);
}

export function arrangeSchedule (coursesInput: Course[], options?: { blockedSlots?: string[] }): ArrangeScheduleResult {
    const blocked = new Set(options?.blockedSlots || []);
    const activeCourses = coursesInput.filter(c => c.active !== false);
    const selectedMap = new Map(activeCourses.map(c => [c.id, c]));

    const bundlesByName: Record<string, CourseBundle[]> = {};
    const selectedExperiments: Course[] = [];
    const mainCourses: Course[] = [];

    for (const c of activeCourses) {
        if (isExperiment(c, selectedMap)) selectedExperiments.push(c);
        else mainCourses.push(c);
    }

    for (const course of mainCourses) {
        const key = course.kcmc;
        if (!bundlesByName[key]) bundlesByName[key] = [];
        const matchingExps = selectedExperiments.filter(exp => exp.id.startsWith(course.id));
        if (matchingExps.length > 0) matchingExps.forEach(exp => bundlesByName[key]?.push([course, exp]));
        else bundlesByName[key]?.push([course]);
    }

    const ks = Object.keys(bundlesByName);
    if (ks.length === 0) return { schedules: [], analyses: [], selectedGroupCount: 0, topConflictHints: [] };

    ks.forEach(k => {
        const list = bundlesByName[k];
        if (!list) return;
        list.sort((b1, b2) => {
            const t1 = b1.reduce((s, c) => s + (c.time?.length || 0), 0);
            const t2 = b2.reduce((s, c) => s + (c.time?.length || 0), 0);
            return t1 - t2;
        });
    });

    const results: CourseBundle[][] = [];
    const used = new Set<string>(blocked);
    const picked: CourseBundle[] = [];

    const canPlaceBundle = (bundle: CourseBundle, currentUsed: Set<string>) => {
        for (const c of bundle) {
            for (const key of courseSlotKeys(c)) if (currentUsed.has(key)) return false;
        }
        return true;
    };

    const applyBundle = (bundle: CourseBundle, currentUsed: Set<string>) => {
        bundle.forEach(c => courseSlotKeys(c).forEach(k => currentUsed.add(k)));
    };

    const revertBundle = (bundle: CourseBundle, currentUsed: Set<string>) => {
        bundle.forEach(c => courseSlotKeys(c).forEach(k => currentUsed.delete(k)));
    };

    function backtrack (i: number) {
        if (results.length >= 100) return;
        if (i === ks.length) {
            results.push(picked.map(b => [...b]));
            return;
        }
        const name = ks[i];
        if (!name) return;
        const optionsByName = bundlesByName[name];
        if (!optionsByName) return;
        for (const bundle of optionsByName) {
            if (!canPlaceBundle(bundle, used)) continue;
            picked.push(bundle);
            applyBundle(bundle, used);
            backtrack(i + 1);
            revertBundle(bundle, used);
            picked.pop();
            if (results.length >= 100) return;
        }
    }

    backtrack(0);

    if (results.length === 0) {
        const MAX_RESULTS = 10;
        const dfsWithSkips = (i: number, skipsLeft: number, currentUsed: Set<string>, currentPicked: CourseBundle[]) => {
            if (results.length >= MAX_RESULTS) return;
            if (i === ks.length) {
                if (currentPicked.length > 0) results.push(currentPicked.map(b => [...b]));
                return;
            }
            const name = ks[i];
            if (!name) return;
            const optionsByName = bundlesByName[name];
            if (!optionsByName) return;

            for (const bundle of optionsByName) {
                if (!canPlaceBundle(bundle, currentUsed)) continue;
                currentPicked.push(bundle);
                applyBundle(bundle, currentUsed);
                dfsWithSkips(i + 1, skipsLeft, currentUsed, currentPicked);
                revertBundle(bundle, currentUsed);
                currentPicked.pop();
                if (results.length >= MAX_RESULTS) return;
            }

            if (skipsLeft > 0) dfsWithSkips(i + 1, skipsLeft - 1, currentUsed, currentPicked);
        };

        for (let s = 1; s < ks.length; s++) {
            dfsWithSkips(0, s, new Set(blocked), []);
            if (results.length > 0) break;
        }
    }

    if (results.length > 0) {
        results.sort((a, b) => {
            const sa = capacityScore(a);
            const sb = capacityScore(b);
            if (sa.over !== sb.over) return sa.over - sb.over;
            if (sa.pressure !== sb.pressure) return sa.pressure - sb.pressure;
            return b.length - a.length;
        });
    }

    const analyses = results.map(schedule => ({
        scheduledGroups: schedule.length,
        incompatible: analyzeIncompatible(schedule, bundlesByName, blocked)
    }));

    return {
        schedules: results,
        analyses,
        selectedGroupCount: ks.length,
        topConflictHints: rankTopConflicts(bundlesByName, blocked)
    };
}
