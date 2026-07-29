import { ref, computed } from 'vue';
import { fetchCourses } from '@/api/course';
import { store } from '@/store/courseStore';
import type { Course } from '@/types';

const courses = ref<Course[]>([]);
const lastUpdatedTs = ref<number | null>(null);
const semesterLabel = ref<string>('当前学期');
const dataSource = ref<'inject' | 'static'>('static');
const isUpdating = ref(false);
const loading = ref(true);
let autoTimer: number | null = null;
let visibilityHooked = false;

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
        const meta = await fetchCourses({ forceRefresh: force });
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
    return {
        courses,
        lastUpdatedTs,
        semesterLabel,
        dataSource,
        isUpdating,
        loading,
        loadedCourseCount,
        refreshCourses,
        syncSelectedCourses,
        startAutoRefresh
    };
}
