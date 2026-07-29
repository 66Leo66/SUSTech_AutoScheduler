<template>
    <el-container style="height: 100%;">
        <el-header
            style="height: auto; padding: 15px 20px; border-bottom: 1px solid var(--el-border-color); display: flex; justify-content: space-between; align-items: center;">
            <el-button @click="$router.push('/')">
                <el-icon>
                    <HomeFilled />
                </el-icon>
                返回首页
            </el-button>
            <h2 style="margin: 0;">选课管理</h2>
            <el-button link @click="$router.push('/help')" style="color: var(--el-text-color-secondary);">
                <el-icon>
                    <QuestionFilled />
                </el-icon>
            </el-button>
        </el-header>

        <el-container style="overflow: hidden;">
            <el-main style="display: flex; flex-direction: column; padding: 0;">
                <div style="padding: 20px;">
                    <h2 style="margin-top: 0;">搜索课程</h2>
                    <el-input v-model="searchQuery" placeholder="输入课程名或教师名(I) | Ctrl+Shift+A 全选 Ctrl+Shift+D 反选"
                        :prefix-icon="Search" clearable @input="onSearch">
                        <template #append>
                            <el-button @click="onSearch">搜索</el-button>
                        </template>
                    </el-input>
                    <div
                        style="margin: 6px 0 10px; font-size: 12px; color: var(--el-text-color-secondary); display: flex; gap: 12px; align-items: center; flex-wrap: wrap;">
                        <span v-if="availableSemesters.length <= 1">当前学期：{{ semesterLabel }}</span>
                        <el-select
                            v-else
                            v-model="selectedSemesterKey"
                            size="small"
                            style="width: 200px;"
                            @change="handleSemesterChange"
                        >
                            <el-option
                                v-for="sem in availableSemesters"
                                :key="sem.xnxq || sem.label"
                                :label="sem.label"
                                :value="sem.xnxq || sem.label"
                            />
                        </el-select>
                        <span>已加载课程：{{ loadedCourseCount }} 门</span>
                        <span>上次更新：{{ lastUpdated }}</span>
                        <span>数据来源：{{ dataSourceLabel }}</span>
                        <el-tag :type="statusTagType" size="small" effect="plain" :disable-transitions="true"
                            @click="handleStatusClick"
                            style="white-space: nowrap; flex-shrink: 0; display: inline-flex; align-items: center; cursor: pointer; flex-wrap: nowrap;">
                            <span class="status-tag-content">
                                <span>{{ isUpdating ? '同步课程中' : `TIS：${injectConnected ? '正常' : '未连接'}` }}</span>
                                <el-icon v-if="isUpdating" class="is-loading" style="margin-left: 2px;">
                                    <Loading />
                                </el-icon>
                                <el-tooltip v-if="injectConnected && !isUpdating" content="重新同步课程" placement="top">
                                    <el-button link size="small" class="status-icon-btn"
                                        @click.stop="handleReloadClick">
                                        <el-icon>
                                            <Refresh />
                                        </el-icon>
                                    </el-button>
                                </el-tooltip>
                                <el-tooltip v-else-if="!injectConnected && !isUpdating" content="查看互联帮助"
                                    placement="top">
                                    <el-button link size="small" class="status-icon-btn"
                                        @click.stop="handleHelpIconClick">
                                        <el-icon>
                                            <QuestionFilled />
                                        </el-icon>
                                    </el-button>
                                </el-tooltip>
                            </span>
                        </el-tag>
                    </div>
                    <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                        <span style="font-size: 12px; color: var(--el-text-color-secondary);">结果列数</span>
                        <el-radio-group v-model="preferredColumns" size="small">
                            <el-radio-button :label="1">1</el-radio-button>
                            <el-radio-button :label="2">2</el-radio-button>
                            <el-radio-button :label="3">3</el-radio-button>
                            <el-radio-button :label="4">4</el-radio-button>
                        </el-radio-group>
                    </div>
                </div>
                <el-scrollbar style="flex: 1; padding: 0 20px;">
                    <template v-if="loading">
                        <div style="padding: 10px 0;">
                            <el-skeleton v-for="i in 4" :key="i" animated style="margin-bottom: 12px;">
                                <template #template>
                                    <el-skeleton-item variant="rect"
                                        style="width: 100%; height: 82px; border-radius: 6px;" />
                                </template>
                            </el-skeleton>
                        </div>
                    </template>
                    <template v-else>
                        <div v-if="!searchQuery && searchResults.length === 0" style="padding: 30px 0;">
                            <el-empty description="输入关键词或点击示例开始搜索" :image-size="120">
                                <el-button v-if="firstExample" type="primary" text
                                    @click="applyExample(firstExample)">试试“{{ firstExample }}”</el-button>
                            </el-empty>
                        </div>
                        <div v-else-if="searchResults.length === 0 && searchQuery" style="padding: 20px;">
                            <el-empty description="无结果，换个关键词试试" :image-size="120">
                                <el-button type="primary" link tag="a"
                                    href="https://github.com/xCipHanD/SUSTech_AutoScheduler/issues/new?template=missing-course-report.md"
                                    target="_blank" rel="noopener noreferrer">没有想要的课？去反馈</el-button>
                            </el-empty>
                        </div>
                        <div class="course-grid" :style="courseGridStyle">
                            <el-card v-for="course in searchResults" :key="course.id" shadow="hover" class="course-card"
                                :class="{ 'is-selected': store.isSelected(course) }"
                                :style="store.isSelected(course) ? { borderColor: 'var(--el-color-primary)', backgroundColor: 'var(--el-color-primary-light-9)' } : {}"
                                @click="store.toggleCourseSelection(course)">
                                <div style="display: flex; justify-content: space-between; gap: 8px; margin-bottom: 4px;">
                                    <span class="course-title">{{ course.kcmc }}</span>
                                    <el-tag v-if="store.isSelected(course)" size="small" type="success">已选</el-tag>
                                </div>
                                <div class="course-line">
                                    <span>Code: {{ course.kcdm }}</span>
                                    <span class="course-ellipsis">{{ course.dgjsmc }}</span>
                                </div>
                                <div class="course-line course-secondary">
                                    <span>人数：{{ formatCapacity(course) }}</span>
                                    <span v-if="course.xf">学分：{{ course.xf }}</span>
                                    <el-tag v-if="hasFullCapacity(course)" size="small" effect="plain"
                                        :type="capacityStatusType(course)">
                                        {{ capacityTagLabel(course) }}
                                    </el-tag>
                                </div>
                                <div class="course-line course-secondary" v-if="formatTimeSummary(course).length">
                                    <span class="course-ellipsis">{{ formatTimeSummary(course).join('；') }}</span>
                                </div>
                                <div class="course-line course-secondary">
                                    <span class="course-ellipsis">{{ course.rwmc }}</span>
                                </div>
                            </el-card>
                        </div>
                    </template>
                </el-scrollbar>
            </el-main>

            <el-aside width="350px"
                style="border-left: 1px solid var(--el-border-color); display: flex; flex-direction: column;">
                <div style="padding: 15px; border-bottom: 1px solid var(--el-border-color-lighter);">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <h3 style="margin: 0;">已选课程</h3>
                        <el-button type="danger" link @click="handleClearSelection" size="small"
                            v-if="store.selectedCourses.length">清空</el-button>
                    </div>
                    <div style="font-size: 12px; color: var(--el-text-color-secondary); margin-top: 5px;">
                        拖拽调整优先级
                    </div>
                </div>
                <el-scrollbar style="flex: 1; padding: 0 10px;">
                    <div v-if="store.selectedCourses.length === 0" style="padding: 24px 12px;">
                        <el-empty description="右侧空空如也，去左侧添加课程吧" :image-size="100">
                            <el-button v-if="firstExample" type="primary" text size="small"
                                @click="applyExample(firstExample)">试试“{{ firstExample }}”</el-button>
                        </el-empty>
                    </div>
                    <div v-else>
                        <transition-group name="list">
                            <div v-for="(course, index) in store.selectedCourses" :key="course.id"
                                style="display: flex; align-items: center; padding: 10px; border-bottom: 1px solid var(--el-border-color-lighter); cursor: move;"
                                draggable="true" @dragstart="dragStart(index)" @drop="onDrop(index)" @dragenter.prevent
                                @dragover.prevent>
                                <div style="margin-right: 10px; cursor: grab; color: var(--el-text-color-secondary);">
                                    <el-icon>
                                        <Rank />
                                    </el-icon>
                                </div>
                                <div
                                    style="flex: 1; display: flex; justify-content: space-between; align-items: center;">
                                    <div style="display: flex; flex-direction: column;">
                                        <span style="font-weight: 500;">{{ course.kcmc }}</span>
                                        <span style="font-size: 12px; color: var(--el-text-color-secondary);">{{
                                            course.dgjsmc
                                            }}</span>
                                        <span
                                            style="font-size: 12px; color: var(--el-text-color-secondary); margin-top: 2px;">
                                            人数：{{ formatCapacity(course) }}
                                        </span>
                                    </div>
                                    <div style="display: flex; align-items: center;">
                                        <el-button link type="danger" @click="store.toggleCourseSelection(course)">
                                            <el-icon>
                                                <Close />
                                            </el-icon>
                                        </el-button>
                                    </div>
                                </div>
                            </div>
                        </transition-group>
                    </div>
                </el-scrollbar>
                <div style="padding: 15px; border-top: 1px solid var(--el-border-color-lighter);">
                    <el-button type="primary" size="large" style="width: 100%;" @click="handleGenerate"
                        :loading="generating">
                        开始排课(Enter)
                    </el-button>
                </div>
            </el-aside>
        </el-container>
    </el-container>
</template>

<script setup lang="ts">
    import { ElMessage } from 'element-plus';
    import { Search, Rank, QuestionFilled, HomeFilled, Close, Loading, Refresh } from '@element-plus/icons-vue';
    import { useMobileDetection } from '../composables/useMobileDetection';
    import { useCourseData } from '../composables/useCourseData';
    import { store } from '../store/courseStore';
    import { arrangeSchedule } from '../utils/scheduleAlgo';
    import { isLabId, getBaseCourseId, hasCatalogLab, hasSelectedLab, hasSelectedLecture } from '@/utils/courseRelation';
    import { formatCourseTimes } from '@/utils/timeCode';
    import type { Course } from '../types';

    useMobileDetection();

    const router = useRouter();
    const { courses: allCourses, lastUpdatedTs, semesterLabel, dataSource, isUpdating, loading, loadedCourseCount, availableSemesters, selectedSemester, refreshCourses, discoverSemesters, selectSemester, startAutoRefresh } = useCourseData();
    const searchQuery = ref('');
    const searchResults = ref<Course[]>([]);
    const exampleKeywords = ['软件工程', '操作系统', '音乐赏析', '数学', '英语'];
    const firstExample = computed(() => exampleKeywords[0] || '');
    const generating = ref(false);
    const dragIndex = ref<number | null>(null);
    const injectConnected = ref(false);
    const selectedSemesterKey = computed({
        get: () => selectedSemester.value?.xnxq ?? selectedSemester.value?.label ?? '',
        set: (_val: string) => { /* handled by @change */ }
    });
    const initialColumns = Number(localStorage.getItem('sustech-course-grid-columns') || 2);
    const preferredColumns = ref<number>(Number.isFinite(initialColumns) ? Math.max(1, Math.min(4, initialColumns)) : 2);
    const viewportWidth = ref(typeof window !== 'undefined' ? window.innerWidth : 1200);
    const safePreferredColumns = computed({
        get: () => {
            const v = Number(preferredColumns.value);
            if (!Number.isFinite(v) || v < 1) return 1;
            if (v > 4) return 4;
            return v;
        },
        set: (val: number) => {
            preferredColumns.value = Math.max(1, Math.min(4, val));
        }
    });
    const effectiveColumns = computed(() => {
        if (viewportWidth.value < 900) return 1;
        if (viewportWidth.value < 1200) return Math.min(2, safePreferredColumns.value);
        return safePreferredColumns.value;
    });
    const courseGridStyle = computed(() => ({
        display: 'grid',
        gap: '8px',
        gridTemplateColumns: `repeat(${effectiveColumns.value}, minmax(0, 1fr))`
    }));
    const dataSourceLabel = computed(() => dataSource.value === 'inject' ? 'TIS实时同步' : '静态兜底 lessons.json');
    const statusTagType = computed(() => {
        if (isUpdating.value) return 'info';
        return injectConnected.value ? 'success' : 'warning';
    });
    const helpAnchor = 'inject-help';
    const lastUpdated = computed(() => {
        if (!lastUpdatedTs.value) return '---';
        const d = new Date(lastUpdatedTs.value);
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        const hh = String(d.getHours()).padStart(2, '0');
        const mi = String(d.getMinutes()).padStart(2, '0');
        return `${mm}-${dd} ${hh}:${mi}`;
    });
    const formatTimeSummary = (course: Course) => formatCourseTimes(course.time || [], 2);

    const hasFullCapacity = (course: Course) => typeof course.yxzrs === 'number' && typeof course.bksrl === 'number' && (course.bksrl ?? 0) > 0;
    const formatCapacity = (course: Course) => {
        const enrolled = course.yxzrs;
        const cap = course.bksrl;
        if (hasFullCapacity(course)) {
            const ratio = cap ? Math.round(((enrolled ?? 0) / cap) * 100) : null;
            return `${enrolled ?? 0}/${cap}${ratio !== null ? ` (${ratio}%)` : ''}`;
        }
        if (typeof enrolled === 'number' && enrolled >= 0) return `${enrolled}/—`;
        return '容量未知';
    };
    const capacityStatusType = (course: Course) => {
        if (!hasFullCapacity(course)) return 'info';
        const enrolled = course.yxzrs ?? 0;
        const cap = course.bksrl ?? 0;
        if (enrolled > cap) return 'danger';
        if (cap > 0 && enrolled / cap >= 0.9) return 'warning';
        return 'success';
    };
    const capacityTagLabel = (course: Course) => {
        if (!hasFullCapacity(course)) return '容量未知';
        const enrolled = course.yxzrs ?? 0;
        const cap = course.bksrl ?? 0;
        if (enrolled > cap) return '超额';
        if (cap - enrolled <= 5) return '接近满额';
        return '容量充足';
    };

    onMounted(() => {
        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('message', onMessageFromInject);
        window.addEventListener('resize', handleResize);
        sendPingToInject();
        // Start shared auto-refresh (includes immediate run)
        startAutoRefresh();
        // Discover available semesters (non-blocking)
        discoverSemesters();
    });

    onUnmounted(() => {
        window.removeEventListener('keydown', handleKeyDown);
        window.removeEventListener('message', onMessageFromInject);
        window.removeEventListener('resize', handleResize);
    });

    watch(safePreferredColumns, (val) => {
        localStorage.setItem('sustech-course-grid-columns', String(val));
    }, { immediate: true });

    const handleResize = () => {
        viewportWidth.value = window.innerWidth;
    };

    const handleKeyDown = (e: KeyboardEvent) => {
        // 如果正在输入框中，只处理 Enter
        const target = e.target as HTMLElement;
        const isInInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';

        if (e.ctrlKey && e.shiftKey && (e.key === 'a' || e.key === 'A')) {
            e.preventDefault();
            // 全选当前搜索结果
            searchResults.value.forEach(course => {
                if (!store.isSelected(course)) {
                    store.toggleCourseSelection(course);
                }
            });
            if (searchResults.value.length > 0) {
                ElMessage.success(`已添加 ${searchResults.value.length} 门课程`);
            }
        } else if (e.ctrlKey && e.shiftKey && (e.key === 'd' || e.key === 'D')) {
            e.preventDefault();
            // 取消当前搜索结果中的全部已选课程
            let count = 0;
            searchResults.value.forEach(course => {
                if (store.isSelected(course)) {
                    store.toggleCourseSelection(course);
                    count++;
                }
            });
            if (count > 0) {
                ElMessage.success(`已取消 ${count} 门课程`);
            }
        } else if (e.key === 'i' || e.key === 'I') {
            if (!isInInput) {
                e.preventDefault();
                // 聚焦搜索框
                const inputElement = document.querySelector('.el-input__inner') as HTMLInputElement;
                if (inputElement) {
                    inputElement.focus();
                }
            }
        } else if (e.key === 'Enter') {
            if (isInInput) {
                e.preventDefault();
                handleGenerate();
            }
        }
    };

    const onSearch = () => {
        if (!searchQuery.value.trim()) {
            searchResults.value = [];
            return;
        }

        // 使用空格分离关键词
        const keywords = searchQuery.value.toLowerCase().trim().split(/\s+/).filter(k => k.length > 0);

        searchResults.value = allCourses.value.filter(c => {
            const courseName = (c.kcmc || '').toLowerCase();
            const teacherName = (c.dgjsmc || '').toLowerCase();
            const courseCode = (c.kcdm || '').toLowerCase();
            const className = (c.rwmc || '').toLowerCase();
            const courseInfo = `${courseName} ${teacherName} ${courseCode} ${className}`;

            // 所有关键词都必须匹配
            return keywords.every(keyword => courseInfo.includes(keyword));
        }).slice(0, 50); // Limit results for performance
    };

    const applyExample = (keyword: string) => {
        if (!keyword) return;
        searchQuery.value = keyword;
        onSearch();
    };

    const dragStart = (index: number) => {
        dragIndex.value = index;
    };

    const onDrop = (dropIndex: number) => {
        if (dragIndex.value === null) return;
        const item = store.selectedCourses[dragIndex.value];
        if (!item) return;
        store.selectedCourses.splice(dragIndex.value, 1);
        store.selectedCourses.splice(dropIndex, 0, item);
        dragIndex.value = null;
    };

    const handleClearSelection = () => {
        store.selectedCourses.splice(0, store.selectedCourses.length);
    };

    const onMessageFromInject = (ev: MessageEvent) => {
        const data: any = ev.data;
        if (!data || data.source !== 'AutoSchedulerInject') return;
        if (data.type === 'hello' || data.type === 'proxyResult') {
            injectConnected.value = true;
        }
    };

    const sendPingToInject = () => {
        try {
            const targetWin = window.parent && window.parent !== window ? window.parent : window;
            targetWin.postMessage({ source: 'AutoSchedulerWeb', type: 'ping' }, '*');
        } catch (e) {
            console.error('ping inject failed', e);
        }
    };

    const handleStatusClick = () => {
        if (isUpdating.value) return;
        if (!injectConnected.value) {
            sendPingToInject();
        }
    };

    const handleHelpIconClick = () => {
        router.push({ path: '/help', query: { section: helpAnchor } });
    };

    const handleReloadClick = () => {
        if (isUpdating.value) return;
        refreshCourses(true);
    };

    const handleSemesterChange = (key: string) => {
        const sem = availableSemesters.value.find(s => (s.xnxq ?? s.label) === key);
        if (sem) selectSemester(sem);
    };

    const ensureLectureLabPairs = () => {
        const selected = store.selectedCourses;
        const all = allCourses.value;

        for (const course of selected) {
            const baseId = getBaseCourseId(course.id);
            const hasLabInCatalog = hasCatalogLab(all, baseId);

            // Only enforce pairing for courses that actually have lab variants in catalog
            if (!hasLabInCatalog) continue;

            const lectureSelected = hasSelectedLecture(selected, baseId);
            const labSelected = hasSelectedLab(selected, baseId);

            if (!isLabId(course.id) && !labSelected) {
                searchQuery.value = course.kcmc;
                onSearch();
                ElMessage.error(`课程 ${course.kcmc} 需要至少选择一门对应的实验课`);
                return false;
            }

            if (isLabId(course.id) && !lectureSelected) {
                const lectureCourse = all.find(c => c.id === baseId);
                searchQuery.value = lectureCourse?.kcmc || baseId;
                onSearch();
                ElMessage.error(`实验课 ${course.kcmc} 需要选择对应的理论课`);
                return false;
            }
        }

        return true;
    };

    const handleGenerate = async () => {
        if (store.selectedCourses.length === 0) {
            ElMessage.warning('请先选择课程');
            return;
        }

        if (!ensureLectureLabPairs()) return;

        generating.value = true;
        setTimeout(() => {
            try {
                const results = arrangeSchedule(store.selectedCourses, { blockedSlots: store.blockedSlots });
                if (results.schedules.length === 0) {
                    store.setResults(results);
                    ElMessage.error('无法生成无冲突课表，请尝试减少课程或降低部分课程优先级');
                } else {
                    store.setResults(results);
                    ElMessage.success(`生成了 ${results.schedules.length} 个方案`);
                    router.push('/schedule');
                }
            } catch (e) {
                console.error(e);
                ElMessage.error('排课过程出错');
            } finally {
                generating.value = false;
            }
        }, 100);
    };
</script>

<style scoped>
    .status-tag-content {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        flex-wrap: nowrap;
    }

    .status-icon-btn {
        padding: 0;
        color: var(--el-text-color-secondary);
        display: inline-flex;
        align-items: center;
        line-height: 1;
        height: auto;
    }

    .course-grid {
        padding-bottom: 8px;
    }

    .course-card {
        cursor: pointer;
    }

    .course-title {
        font-weight: 700;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .course-line {
        font-size: 12px;
        color: var(--el-text-color-regular);
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 6px;
        margin-top: 3px;
    }

    .course-secondary {
        color: var(--el-text-color-secondary);
    }

    .course-ellipsis {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
</style>
