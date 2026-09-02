import { reactive, watch } from 'vue';
import type { Course, CourseBundle, ScheduleAnalysis, IncompatibleCourseGroup } from '../types';
import { getBaseCourseId, isLabId } from '@/utils/courseRelation';

const STORAGE_KEY = 'sustech-course-selection';
const BLOCKED_STORAGE_KEY = 'sustech-schedule-blocked-slots';

function loadBlockedSlots (): string[] {
    try {
        const stored = localStorage.getItem(BLOCKED_STORAGE_KEY);
        if (!stored) return [];
        const parsed = JSON.parse(stored);
        return Array.isArray(parsed) ? parsed.filter(v => typeof v === 'string') : [];
    } catch (error) {
        console.error('Failed to load blocked slots from localStorage:', error);
        return [];
    }
}

function saveBlockedSlots (slots: string[]) {
    try {
        localStorage.setItem(BLOCKED_STORAGE_KEY, JSON.stringify(slots));
    } catch (error) {
        console.error('Failed to save blocked slots to localStorage:', error);
    }
}

// 从 localStorage 加载已选课程
function loadSelectedCourses (): Course[] {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
            return JSON.parse(stored);
        }
    } catch (error) {
        console.error('Failed to load selected courses from localStorage:', error);
    }
    return [];
}

// 保存已选课程到 localStorage
function saveSelectedCourses (courses: Course[]) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(courses));
    } catch (error) {
        console.error('Failed to save selected courses to localStorage:', error);
    }
}

export type CourseGroup = { name: string; courses: Course[] };

export function groupCoursesByName (courses: Course[]): CourseGroup[] {
    const groups = new Map<string, CourseGroup>();
    courses.forEach(course => {
        let group = groups.get(course.kcmc);
        if (!group) {
            group = { name: course.kcmc, courses: [] };
            groups.set(course.kcmc, group);
        }
        group.courses.push(course);
    });
    return [...groups.values()];
}

export const store = reactive({
    selectedCourses: loadSelectedCourses() as Course[],
    blockedSlots: loadBlockedSlots() as string[],
    scheduleResults: [] as CourseBundle[][],
    scheduleAnalyses: [] as ScheduleAnalysis[],
    selectedGroupCount: 0,
    topConflictHints: [] as IncompatibleCourseGroup[],
    currentResultIndex: 0,

    toggleCourseSelection (course: Course) {
        const index = this.selectedCourses.findIndex(c => c.id === course.id);
        if (index > -1) {
            this.selectedCourses.splice(index, 1);
        } else {
            // Add new course with active state true by default
            this.selectedCourses.push({ ...course, active: true });
        }
        saveSelectedCourses(this.selectedCourses);
    },

    isSelected (course: Course) {
        return this.selectedCourses.some(c => c.id === course.id);
    },

    toggleCourseGroupActive (name: string, isActive: boolean) {
        this.selectedCourses.forEach(course => {
            if (course.kcmc === name) course.active = isActive;
        });
        saveSelectedCourses(this.selectedCourses);
    },

    removeCourseGroup (name: string) {
        for (let i = this.selectedCourses.length - 1; i >= 0; i--) {
            if (this.selectedCourses[i]?.kcmc === name) this.selectedCourses.splice(i, 1);
        }
        saveSelectedCourses(this.selectedCourses);
    },

    reorderCourseGroups (from: number, to: number) {
        const groups = groupCoursesByName(this.selectedCourses);
        if (from === to || !groups[from] || !groups[to]) return;
        const [moved] = groups.splice(from, 1);
        if (!moved) return;
        groups.splice(to, 0, moved);
        this.selectedCourses.splice(0, this.selectedCourses.length, ...groups.flatMap(group => group.courses));
        saveSelectedCourses(this.selectedCourses);
    },

    toggleCourseActive (courseId: string, isActive: boolean) {
        const course = this.selectedCourses.find(c => c.id === courseId);
        if (course) {
            course.active = isActive;

            const baseId = getBaseCourseId(courseId);

            if (isActive) {
                // Turning on a lecture turns on all its labs
                if (!isLabId(courseId)) {
                    this.selectedCourses.forEach(c => {
                        if (isLabId(c.id) && getBaseCourseId(c.id) === baseId) {
                            c.active = true;
                        }
                    });
                }

                // Turning on a lab turns on its lecture
                if (isLabId(courseId)) {
                    const lecture = this.selectedCourses.find(c => !isLabId(c.id) && c.id === baseId);
                    if (lecture) lecture.active = true;
                }
            } else {
                // Turning off a lecture turns off its labs
                if (!isLabId(courseId)) {
                    this.selectedCourses.forEach(c => {
                        if (isLabId(c.id) && getBaseCourseId(c.id) === baseId) {
                            c.active = false;
                        }
                    });
                }

                // Turning off a lab: if no other active labs remain, also turn off the lecture
                if (isLabId(courseId)) {
                    const hasOtherActiveLab = this.selectedCourses.some(c => isLabId(c.id) && getBaseCourseId(c.id) === baseId && c.id !== courseId && c.active !== false);
                    if (!hasOtherActiveLab) {
                        const lecture = this.selectedCourses.find(c => !isLabId(c.id) && c.id === baseId);
                        if (lecture) lecture.active = false;
                    }
                }
            }
        }
        saveSelectedCourses(this.selectedCourses);
    },

    setResults (payload: { schedules: CourseBundle[][]; analyses?: ScheduleAnalysis[]; selectedGroupCount?: number; topConflictHints?: IncompatibleCourseGroup[] } | CourseBundle[][]) {
        if (Array.isArray(payload)) {
            this.scheduleResults = payload;
            this.scheduleAnalyses = [];
            this.selectedGroupCount = 0;
            this.topConflictHints = [];
            this.currentResultIndex = 0;
            return;
        }
        this.scheduleResults = payload.schedules;
        this.scheduleAnalyses = payload.analyses || [];
        this.selectedGroupCount = payload.selectedGroupCount ?? 0;
        this.topConflictHints = payload.topConflictHints || [];
        this.currentResultIndex = 0;
    },

    isBlockedSlot (week: 1 | 2, day: number, slotIndex: number) {
        return this.blockedSlots.includes(`${week}-${day}-${slotIndex}`);
    },

    toggleBlockedSlot (week: 1 | 2, day: number, slotIndex: number) {
        const key = `${week}-${day}-${slotIndex}`;
        const idx = this.blockedSlots.indexOf(key);
        if (idx >= 0) this.blockedSlots.splice(idx, 1);
        else this.blockedSlots.push(key);
        saveBlockedSlots(this.blockedSlots);
    },

    clearBlockedSlots () {
        this.blockedSlots.splice(0, this.blockedSlots.length);
        saveBlockedSlots(this.blockedSlots);
    },

    clearSelection () {
        this.selectedCourses.splice(0, this.selectedCourses.length);
        saveSelectedCourses(this.selectedCourses);
    }
});

// 监听 selectedCourses 的变化,自动保存
watch(() => store.selectedCourses, (newCourses) => {
    saveSelectedCourses(newCourses);
}, { deep: true });

watch(() => store.blockedSlots, (newSlots) => {
    saveBlockedSlots(newSlots);
}, { deep: true });
