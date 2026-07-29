import { ref, computed } from 'vue';
import { fetchCourses, discoverAvailableSemesters } from '@/api/course';
import type { SemesterMeta } from '@/api/course';
import { store } from '@/store/courseStore';
import type { Course } from '@/types';

const courses = ref<Course[]>([]);
const lastUpdatedTs = ref<number | null>(null);
const semesterLabel = ref<string>('当前学期');
const dataSource = ref<'inject' | 'static'>('static');
const isUpdating = ref(false);
const loading = ref(true);
const availableSemesters = ref<SemesterMeta[]>([]);
const selectedSemester = ref<SemesterMeta | null>(null);
let autoTimer: number | null = null;
let visibilityHooked = false;

const SEMESTER_STORAGE_KEY = 'sustech-selected-semester';

function loadSelectedSemester (): SemesterMeta | null {
    try {
        const raw = localStorage.getItem(SEMESTER_STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.label === 'string') return parsed as SemesterMeta;
        return null;
    } catch {
        return null;
    }
}

function saveSelectedSemester (sem: SemesterMeta | null) {
    try {
        if (sem) localStorage.setItem(SEMESTER_STORAGE_KEY, JSON.stringify(sem));
        else localStorage.removeItem(SEMESTER_STORAGE_KEY);
    } catch { /* ignore */ }
}

const syncSelectedCourses = (latest: Course[]) => {
    const map = new Map(latest.map(c => [c.id, c]));
    store.selectedCourses.forEach((c, idx) => {
        const next = map.get(c.id);
        if (!next) return;
        const active = c.active !== false;
        // Replace to pick up newest fields (e.g., capacity/time) while keeping active flag
        store.selectedCourses[idx] = { ...next, active };
    });
};

const refreshCourses = async (force = false) => {
    isUpdating.value = true;
    try {
        const meta = await fetchCourses({ forceRefresh: force, semester: selectedSemester.value ?? undefined });
        courses.value = meta.courses;
        lastUpdatedTs.value = meta.updatedAt;
        semesterLabel.value = meta.semester.label;
        dataSource.value = meta.source;
        syncSelectedCourses(meta.courses);
        return meta.courses;
    } finally {
        loading.value = false;
        isUpdating.value = false;
    }
};

const discoverSemesters = async () => {
    const semesters = await discoverAvailableSemesters();
    availableSemesters.value = semesters;
    if (semesters.length > 0 && !selectedSemester.value) {
        // Default to the first (current) semester
        const first = semesters[0]!;
        selectedSemester.value = first;
        saveSelectedSemester(first);
    }
    return semesters;
};

const selectSemester = async (sem: SemesterMeta) => {
    if (selectedSemester.value?.xnxq === sem.xnxq && selectedSemester.value?.label === sem.label) return;
    selectedSemester.value = sem;
    saveSelectedSemester(sem);
    await refreshCourses(true);
};

const startAutoRefresh = (intervalMs = 30_000, onRefreshed?: (courses: Course[]) => void) => {
    if (autoTimer) return;

    const tick = async () => {
        if (isUpdating.value) return;
        try {
            const data = await refreshCourses();
            if (onRefreshed && data) onRefreshed(data);
        } catch (e) {
            // Swallow errors to keep timer alive
            console.error('auto refresh courses failed', e);
        }
    };

    // immediate kick-off
    tick();
    autoTimer = window.setInterval(tick, intervalMs);

    if (!visibilityHooked && typeof document !== 'undefined') {
        visibilityHooked = true;
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') {
                tick();
            }
        });
    }
};

const loadedCourseCount = computed(() => courses.value.length);

export function useCourseData () {
    // Restore persisted semester on first call
    if (!selectedSemester.value) {
        const saved = loadSelectedSemester();
        if (saved) selectedSemester.value = saved;
    }
    return {
        courses,
        lastUpdatedTs,
        semesterLabel,
        dataSource,
        isUpdating,
        loading,
        loadedCourseCount,
        availableSemesters,
        selectedSemester,
        refreshCourses,
        discoverSemesters,
        selectSemester,
        syncSelectedCourses,
        startAutoRefresh
    };
}
