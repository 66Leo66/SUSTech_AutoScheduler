import type { Course } from '@/types';
import { toSlotKeys } from '@/utils/timeCode';

/**
 * 解析课程时间代码,判断课程是否在指定时间段
 * @param course 课程对象
 * @param week 周次 (1=单周, 2=双周)
 * @param day 星期 (1-7)
 * @param slotIndex 时间段索引 (0-5)
 * @returns 如果课程在该时间段则返回true
 */
export function isCourseAtTime(
    course: Course,
    week: number,
    day: number,
    slotIndex: number
): boolean {
    if (!course.time) return false;
    const targetKey = `${week}-${day}-${slotIndex}`;
    for (const t of course.time) {
        const keys = toSlotKeys(t);
        if (keys.includes(targetKey)) return true;
    }
    return false;
}

/**
 * 在课程列表中查找指定时间段的课程
 */
export function findCourseAtTime(
    courses: Course[],
    week: number,
    day: number,
    slotIndex: number
): Course | undefined {
    return courses.find(course => isCourseAtTime(course, week, day, slotIndex));
}
