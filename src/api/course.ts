import type { Course } from '@/types';

const INJECT_SOURCE = 'AutoSchedulerInject';
const WEB_SOURCE = 'AutoSchedulerWeb';
const CACHE_KEY = 'autoSchedulerCoursesCacheV1';
const DEFAULT_MAX_AGE_MS = 1 * 60 * 1000; // 1 minute
const STATIC_FALLBACK_UPDATED_AT = Date.parse('2026-07-18T00:00:00+08:00');

let cachedCourses: Course[] | null = null;
let cachedUpdatedAt: number | null = null;
let cachedCachedAt: number | null = null;
let proxyListenerReady = false;
let injectHello = false;
const helloWaiters: Array<(v: boolean) => void> = [];
const pendingRequests = new Map<string, { resolve: (v: any) => void; reject: (e: Error) => void; timer: number }>();

type CachedPayload = { courses: Course[]; updatedAt: number; cachedAt?: number };
export type SemesterMeta = {
    year?: string;
    term?: string;
    xnxq?: string;
    label: string;
};
export type FetchCoursesResult = {
    courses: Course[];
    updatedAt: number;
    fromCache: boolean;
    source: 'inject' | 'static';
    semester: SemesterMeta;
};

function periodToHex (p: number): string {
    return p < 10 ? String(p) : String.fromCharCode('A'.charCodeAt(0) + p - 10);
}

function parseTime (html: string): { lab: string[]; requirement: string | null } {
    const weekdayMap: Record<string, number> = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 7 };
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    const result = { lab: [] as string[], requirement: null as string | null };
    let hasMainTask = false;

    const reqNode = Array.from(doc.querySelectorAll('p, div, span'))
        .map(n => n.textContent || '')
        .find(t => t.includes('选课要求'));
    if (reqNode) result.requirement = reqNode.replace(/.*选课要求[:：]?/, '').trim() || null;

    const blocks = Array.from(doc.querySelectorAll('p'));
    let currentSection: 'main_task' | 'lab' | null = null;

    const getLinesFromTag = (tag: Element) => {
        const ps = Array.from(tag.querySelectorAll('p'));
        if (ps.length) return ps.map(p => (p.textContent || '').trim()).filter(Boolean);
        return (tag.textContent || '').split('\n').map(l => l.trim()).filter(Boolean);
    };

    const pushLines = (lines: string[], section: 'main_task' | 'lab' | null) => {
        lines.forEach(line => {
            const weekday = /星期([一二三四五六日])/.exec(line);
            const periods = /第(\d+)-(\d+)节/.exec(line);
            const weekPart = /^([0-9,\-单双]+)周/.exec(line);
            const weekdayKey = weekday?.[1];
            const startStr = periods?.[1];
            const endStr = periods?.[2];
            const weekRaw = weekPart?.[1];
            if (!weekdayKey || !startStr || !endStr || !weekRaw) return;

            const dayNum = weekdayMap[weekdayKey];
            if (!dayNum) return;
            const startP = parseInt(startStr, 10);
            const endP = parseInt(endStr, 10);
            if (!Number.isFinite(startP) || !Number.isFinite(endP)) return;

            const pairs: string[] = [];
            let cur = startP;
            while (cur <= endP) {
                const nxt = cur + 1;
                if (nxt <= endP) { pairs.push(periodToHex(cur) + periodToHex(nxt)); cur += 2; }
                else { pairs.push(periodToHex(cur) + periodToHex(cur)); cur += 1; }
            }

            const shouldRecord = section === 'lab' || section === 'main_task' || section === null;

            weekRaw.split(',').forEach(part => {
                if (!part) return;
                const m = /(\d+(?:-\d+)?)([单双]?)/.exec(part);
                if (!m) return;
                const range = m[1] || '';
                const flag = m[2] || '';
                const weeks: number[] = [];
                if (range.includes('-')) {
                    const [sStr, eStr] = range.split('-');
                    const s = Number(sStr);
                    const e = Number(eStr);
                    if (Number.isFinite(s) && Number.isFinite(e)) {
                        for (let w = s; w <= e; w++) weeks.push(w);
                    }
                } else {
                    const v = Number(range);
                    if (Number.isFinite(v)) weeks.push(v);
                }
                weeks.forEach(week => {
                    let prefix: string;
                    if (flag === '单') { if (week % 2 === 0) return; prefix = '1'; }
                    else if (flag === '双') { if (week % 2 === 1) return; prefix = '2'; }
                    else { prefix = week % 2 === 1 ? '1' : '2'; }
                    pairs.forEach(ps => { if (shouldRecord) result.lab.push(prefix + String(dayNum) + ps); });
                });
            });
        });
    };

    blocks.forEach(p => {
        const text = (p.textContent || '').trim();
        if (text.startsWith('主任务')) { hasMainTask = true; currentSection = 'main_task'; return; }
        if (text.startsWith('课内实验')) { currentSection = 'lab'; return; }
        if (!hasMainTask && result.lab.length === 0 && p.querySelector('a')) { currentSection = 'lab'; }

        if (text.includes('上课信息')) {
            const tag = p.querySelector('.ivu-tag') || p.nextElementSibling;
            if (!tag) return;
            const lines = getLinesFromTag(tag);
            pushLines(lines, currentSection);
        }
    });

    // Fallback: parse any ivu-tag blocks even if there's no preceding "上课信息" marker
    const looseTags = Array.from(doc.querySelectorAll('.ivu-tag')); // safe, small DOM
    looseTags.forEach(tag => {
        const lines = getLinesFromTag(tag);
        pushLines(lines, currentSection);
    });

    const seen = new Set<string>();
    const uniq: string[] = [];
    result.lab.forEach(t => { if (!seen.has(t)) { seen.add(t); uniq.push(t); } });
    result.lab = uniq;
    return result;
}

function mapCoursesFromRaw (raw: any[]): Course[] {
    const lessons: Course[] = [];
    const seen = new Set<string>();
    raw.forEach(item => {
        const id = item.rwh;
        if (seen.has(id)) return;
        const kcxx = item.kcxx;
        if (!kcxx) return;
        const parsed = parseTime(kcxx);
        if (!parsed.lab.length) return;
        seen.add(id);
        const enrolled = Number.isFinite(Number(item.yxzrs)) ? Number(item.yxzrs) : null;
        const capacity = Number.isFinite(Number(item.bksrl)) ? Number(item.bksrl) : null;
        lessons.push({
            id,
            kcdm: item.kcdm,
            kcmc: item.kcmc,
            xf: item.xf,
            dgjsmc: item.dgjsmc,
            pyccmc: item.pyccmc,
            kkyxmc: item.kkyxmc,
            skyymc: item.skyymc,
            rwmc: item.rwmc,
            time: parsed.lab,
            info: parsed.requirement,
            yxzrs: enrolled,
            bksrl: capacity,
            active: true,
        });
    });
    return lessons;
}

function mapCourses (raw: any[]): Course[] {
    return raw.map((c: any) => ({
        ...c,
        // Ensure numeric types when static data already contains these fields
        yxzrs: Number.isFinite(Number(c?.yxzrs)) ? Number(c.yxzrs) : c?.yxzrs ?? null,
        bksrl: Number.isFinite(Number(c?.bksrl)) ? Number(c.bksrl) : c?.bksrl ?? null,
        active: true
    }));
}

function deriveSemesterMeta (courses: Course[], fallbackYear?: string, fallbackTerm?: string, fallbackXnxq?: string): SemesterMeta {
    const id = courses.find(c => typeof c.id === 'string' && c.id.includes('-'))?.id || '';
    const m = /^(\d{4})-(\d{4})-(\d)/.exec(id);
    const year = m?.[1] && m?.[2] ? `${m[1]}-${m[2]}` : (fallbackYear || undefined);
    const term = m?.[3] || fallbackTerm || undefined;
    const xnxq = m?.[1] && m?.[2] && m?.[3] ? `${m[1]}-${m[2]}${m[3]}` : (fallbackXnxq || undefined);
    const termLabel = term === '1' ? '秋季学期' : term === '2' ? '春季学期' : '学期';
    const label = year ? `${year} ${termLabel}` : `当前${termLabel}`;
    return { year, term, xnxq, label };
}

function buildSemesterCandidates (): Array<{ year?: string; term?: string; xnxq?: string }> {
    const now = new Date();
    const y = now.getFullYear();
    const month = now.getMonth() + 1;
    const fallFirst = month >= 8;
    const primaryYearStart = fallFirst ? y : y - 1;
    const primaryTerm = fallFirst ? '1' : '2';
    const candidates: Array<{ year?: string; term?: string; xnxq?: string }> = [{}, { year: `${primaryYearStart}-${primaryYearStart + 1}`, term: primaryTerm, xnxq: `${primaryYearStart}-${primaryYearStart + 1}${primaryTerm}` }];
    const pairs = [
        { s: primaryYearStart, t: primaryTerm },
        { s: primaryYearStart, t: primaryTerm === '1' ? '2' : '1' },
        { s: primaryYearStart - 1, t: '1' },
        { s: primaryYearStart - 1, t: '2' },
        { s: primaryYearStart + 1, t: '1' },
        { s: primaryYearStart + 1, t: '2' }
    ];
    for (const p of pairs) {
        const year = `${p.s}-${p.s + 1}`;
        candidates.push({ year, term: p.t, xnxq: `${year}${p.t}` });
    }

    const seen = new Set<string>();
    return candidates.filter(c => {
        const key = `${c.year || ''}|${c.term || ''}|${c.xnxq || ''}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function inferSource (courses: Course[]): 'inject' | 'static' {
    return courses.some(c => typeof c.yxzrs === 'number' || typeof c.bksrl === 'number') ? 'inject' : 'static';
}

function loadCache (): CachedPayload | null {
    try {
        const raw = localStorage.getItem(CACHE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || !Array.isArray(parsed.courses) || typeof parsed.updatedAt !== 'number') return null;
        return parsed as CachedPayload;
    } catch (e) {
        console.warn('read cache failed', e);
        return null;
    }
}

function saveCache (payload: CachedPayload) {
    try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
    } catch (e) {
        console.warn('write cache failed', e);
    }
}

function setupProxyListener () {
    if (proxyListenerReady) return;
    proxyListenerReady = true;
    window.addEventListener('message', (ev: MessageEvent) => {
        const data: any = ev.data;
        if (!data || data.source !== INJECT_SOURCE) return;
        if (data.type === 'hello') {
            injectHello = true;
            helloWaiters.splice(0).forEach(fn => fn(true));
        } else if (data.type === 'proxyResult' && data.payload?.requestId) {
            const pending = pendingRequests.get(data.payload.requestId);
            if (pending) {
                window.clearTimeout(pending.timer);
                pending.resolve(data.payload);
                pendingRequests.delete(data.payload.requestId);
            }
        } else if (data.type === 'error') {
            const reqId = data.payload?.requestId;
            if (reqId && pendingRequests.has(reqId)) {
                const pending = pendingRequests.get(reqId)!;
                window.clearTimeout(pending.timer);
                pending.reject(new Error(data.payload?.message || 'inject error'));
                pendingRequests.delete(reqId);
            }
        }
    });
}

async function fetchViaInject (timeoutMs = 4000): Promise<{ courses: Course[]; semester: SemesterMeta } | null> {
    setupProxyListener();

    const waitForHello = (deadlineMs = 100): Promise<boolean> => {
        if (injectHello) return Promise.resolve(true);
        return new Promise(resolve => {
            const timer = window.setTimeout(() => {
                helloWaiters.splice(0).forEach(fn => fn(false));
                resolve(false);
            }, deadlineMs);
            helloWaiters.push((ok) => {
                window.clearTimeout(timer);
                resolve(ok);
            });
            try {
                const targetWin = window.parent && window.parent !== window ? window.parent : window;
                targetWin.postMessage({ source: WEB_SOURCE, type: 'ping' }, '*');
            } catch (e) {
                console.error('hello ping failed', e);
            }
        });
    };

    const sendProxyRequest = (payload: any, deadlineMs = timeoutMs): Promise<any> => {
        const requestId = `proxy-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        return new Promise((resolve, reject) => {
            const timer = window.setTimeout(() => {
                pendingRequests.delete(requestId);
                reject(new Error('proxy fetch timeout'));
            }, deadlineMs);
            pendingRequests.set(requestId, { resolve, reject, timer });
            try {
                const targetWin = window.parent && window.parent !== window ? window.parent : window;
                targetWin.postMessage({ source: WEB_SOURCE, type: 'proxyFetch', payload: { ...payload, requestId } }, '*');
            } catch (e) {
                window.clearTimeout(timer);
                pendingRequests.delete(requestId);
                reject(e as Error);
            }
        });
    };

    async function fetchPage (payload: any, pageNum: number, pageSize: number) {
        const form = new URLSearchParams({
            p_chapylx: '',
            ordertext_0: '',
            p_xiaoqu: payload.campus || '1',
            p_chaxunpylx: '3',
            mxpylx: '3',
            p_sfhltsxx: '0',
            pageNum: String(pageNum),
            pageSize: String(pageSize),
        });
        if (payload.year) form.set('p_xn', payload.year);
        if (payload.term) form.set('p_xq', payload.term);
        if (payload.xnxq) form.set('p_xnxq', payload.xnxq);

        const res = await sendProxyRequest({
            url: 'https://tis.sustech.edu.cn/Xsxktz/queryRwxxcxList',
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
            body: form.toString(),
            responseType: 'json'
        });

        if (!res?.ok || !res.body) throw new Error('page fetch failed');
        const rwList = res.body.rwList || {};
        const list = rwList.list || rwList.data || [];
        const total = rwList.total || list.length;
        return { list, total };
    }

    try {
        const helloOk = await waitForHello();
        if (!helloOk) return null;

        const pageSize = 500;
        const candidates = buildSemesterCandidates();

        for (const candidate of candidates) {
            let pageNum = 1;
            const data: any[] = [];
            let total: number | null = null;
            let failed = false;

            while (true) {
                try {
                    const { list, total: t } = await fetchPage(candidate, pageNum, pageSize);
                    if (total === null) total = t;
                    data.push(...list);
                    if (data.length >= total! || list.length === 0) break;
                    pageNum += 1;
                } catch {
                    failed = true;
                    break;
                }
            }

            if (failed || data.length === 0) continue;

            const courses = mapCoursesFromRaw(data);
            if (!courses.length) continue;
            cachedCourses = courses;
            return { courses, semester: deriveSemesterMeta(courses, candidate.year, candidate.term, candidate.xnxq) };
        }
        return null;
    } catch (e) {
        console.error('inject fetch failed', e);
        return null;
    }
}

async function fetchStatic (): Promise<{ courses: Course[]; updatedAt: number; semester: SemesterMeta }> {
    const response = await fetch('/lessons.json');
    if (!response.ok) {
        throw new Error('Failed to load lessons');
    }
    const data = await response.json();
    const updatedAt = Number.isFinite(STATIC_FALLBACK_UPDATED_AT) ? STATIC_FALLBACK_UPDATED_AT : Date.now();
    const courses = mapCourses(data);
    return { courses, updatedAt, semester: deriveSemesterMeta(courses) };
}

export async function fetchCourses (options?: { forceRefresh?: boolean; maxAgeMs?: number }): Promise<FetchCoursesResult> {
    const maxAgeMs = options?.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
    const now = Date.now();
    const isFresh = (ageBase?: number | null) => ageBase !== undefined && ageBase !== null && now - ageBase <= maxAgeMs;

    if (!options?.forceRefresh && cachedCourses) {
        const ageBase = cachedCachedAt ?? cachedUpdatedAt;
        if (isFresh(ageBase)) {
            return {
                courses: cachedCourses,
                updatedAt: cachedUpdatedAt ?? ageBase ?? now,
                fromCache: true,
                source: inferSource(cachedCourses),
                semester: deriveSemesterMeta(cachedCourses)
            };
        }
    }

    if (!options?.forceRefresh) {
        const cached = loadCache();
        const cachedAgeBase = cached?.cachedAt ?? cached?.updatedAt;
        if (cached && cachedAgeBase && now - cachedAgeBase <= maxAgeMs && cached.courses.length) {
            cachedCourses = cached.courses;
            cachedUpdatedAt = cached.updatedAt;
            cachedCachedAt = cached.cachedAt ?? cached.updatedAt;
            return {
                courses: cached.courses,
                updatedAt: cached.updatedAt,
                fromCache: true,
                source: inferSource(cached.courses),
                semester: deriveSemesterMeta(cached.courses)
            };
        }
    }

    const injectData = await fetchViaInject().catch(() => null);
    if (injectData && injectData.courses.length) {
        cachedCourses = injectData.courses;
        cachedUpdatedAt = now;
        cachedCachedAt = now;
        const payload: CachedPayload = { courses: injectData.courses, updatedAt: cachedUpdatedAt, cachedAt: cachedCachedAt };
        saveCache(payload);
        return {
            courses: injectData.courses,
            updatedAt: cachedUpdatedAt,
            fromCache: false,
            source: 'inject',
            semester: injectData.semester
        };
    }

    try {
        const { courses, updatedAt, semester } = await fetchStatic();
        cachedCourses = courses;
        cachedUpdatedAt = updatedAt;
        cachedCachedAt = now;
        const payload: CachedPayload = { courses, updatedAt: cachedUpdatedAt, cachedAt: cachedCachedAt };
        saveCache(payload);
        return { courses, updatedAt: cachedUpdatedAt, fromCache: false, source: 'static', semester };
    } catch (e) {
        console.error(e);
        cachedUpdatedAt = now;
        cachedCachedAt = now;
        return {
            courses: [],
            updatedAt: cachedUpdatedAt,
            fromCache: false,
            source: 'static',
            semester: { label: '当前学期' }
        };
    }
}
