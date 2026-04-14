import { promises as fs } from 'fs';
import path from 'path';
import type { NextRequest } from 'next/server';
import type { Scene, Stage } from '@/lib/types/stage';
import { createClient } from '@supabase/supabase-js';
import { createLogger } from '@/lib/logger';

const log = createLogger('ClassroomStorage');

export const CLASSROOMS_DIR = path.join(process.cwd(), 'data', 'classrooms');
export const CLASSROOM_JOBS_DIR = path.join(process.cwd(), 'data', 'classroom-jobs');

function getSupabaseConfig() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  log.debug('[DEBUG] NEXT_PUBLIC_SUPABASE_URL:', supabaseUrl ? 'SET' : 'MISSING');
  log.debug('[DEBUG] SUPABASE_SERVICE_ROLE_KEY:', process.env.SUPABASE_SERVICE_ROLE_KEY ? 'SET' : 'MISSING');
  log.debug('[DEBUG] NEXT_PUBLIC_SUPABASE_ANON_KEY:', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ? 'SET' : 'MISSING');

  if (!supabaseUrl || !supabaseServiceKey) {
    log.warn('Supabase service credentials not fully configured');
  }

  return { supabaseUrl, supabaseServiceKey };
}

export function isSupabaseServerConfigured(): boolean {
  const { supabaseUrl, supabaseServiceKey } = getSupabaseConfig();
  return Boolean(supabaseUrl && supabaseServiceKey);
}

function createSupabaseServerClient() {
  const { supabaseUrl, supabaseServiceKey } = getSupabaseConfig();
  if (!supabaseUrl || !supabaseServiceKey) return null;
  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

export async function ensureClassroomsDir() {
  await ensureDir(CLASSROOMS_DIR);
}

export async function ensureClassroomJobsDir() {
  await ensureDir(CLASSROOM_JOBS_DIR);
}

export async function writeJsonFileAtomic(filePath: string, data: unknown) {
  const dir = path.dirname(filePath);
  await ensureDir(dir);

  const tempFilePath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const content = JSON.stringify(data, null, 2);
  await fs.writeFile(tempFilePath, content, 'utf-8');
  await fs.rename(tempFilePath, filePath);
}

export function buildRequestOrigin(req: NextRequest): string {
  return req.headers.get('x-forwarded-host')
    ? `${req.headers.get('x-forwarded-proto') || 'http'}://${req.headers.get('x-forwarded-host')}`
    : req.nextUrl.origin;
}

export interface PersistedClassroomData {
  id: string;
  stage: Stage;
  scenes: Scene[];
  outlines?: unknown[];
  createdAt: string;
}

export function isValidClassroomId(id: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(id);
}

export async function readClassroom(id: string): Promise<PersistedClassroomData | null> {
  const filePath = path.join(CLASSROOMS_DIR, `${id}.json`);
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content) as PersistedClassroomData;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

export async function readClassroomFromSupabase(id: string): Promise<PersistedClassroomData | null> {
  if (!isSupabaseServerConfigured()) {
    return null;
  }

  const supabase = createSupabaseServerClient();
  if (!supabase) return null;

  try {
    const { data, error } = await supabase
      .from('classrooms')
      .select('data, created_at')
      .eq('id', id)
      .single();

    if (error || !data) {
      log.debug(`Classroom ${id} not found in Supabase`);
      return null;
    }

    return {
      id,
      stage: data.data?.stage || {},
      scenes: data.data?.scenes || [],
      outlines: data.data?.outlines || [],
      createdAt: data.created_at,
    };
  } catch (err) {
    log.error(`Error reading classroom ${id} from Supabase:`, err);
    return null;
  }
}

export async function listClassroomsFromSupabase(options?: {
  limit?: number;
  offset?: number;
  language?: string;
}): Promise<{ id: string; name: string; description?: string; language?: string; scene_count: number; created_at: string; updated_at: string }[]> {
  if (!isSupabaseServerConfigured()) {
    return [];
  }

  const supabase = createSupabaseServerClient();
  if (!supabase) return [];

  try {
    let query = supabase
      .from('classrooms')
      .select('id, name, description, language, scene_count, created_at, updated_at')
      .order('created_at', { ascending: false });

    if (options?.language) {
      query = query.eq('language', options.language);
    }

    if (options?.limit) {
      query = query.limit(options.limit);
    }

    if (options?.offset) {
      query = query.range(options.offset, (options.offset + (options.limit || 20)) - 1);
    }

    const { data, error } = await query;

    if (error) {
      log.error('Error listing classrooms from Supabase:', error);
      return [];
    }

    return data || [];
  } catch (err) {
    log.error('Error listing classrooms from Supabase:', err);
    return [];
  }
}

export async function deleteClassroomFromSupabase(id: string): Promise<boolean> {
  if (!isSupabaseServerConfigured()) {
    return false;
  }

  const supabase = createSupabaseServerClient();
  if (!supabase) return false;

  try {
    const { error } = await supabase
      .from('classrooms')
      .delete()
      .eq('id', id);

    if (error) {
      log.error(`Error deleting classroom ${id} from Supabase:`, error);
      return false;
    }

    log.info(`Classroom ${id} deleted from Supabase`);
    return true;
  } catch (err) {
    log.error(`Error deleting classroom ${id} from Supabase:`, err);
    return false;
  }
}

export async function persistClassroom(
  data: {
    id: string;
    stage: Stage;
    scenes: Scene[];
  },
  baseUrl: string,
): Promise<PersistedClassroomData & { url: string }> {
  const classroomData: PersistedClassroomData = {
    id: data.id,
    stage: data.stage,
    scenes: data.scenes,
    createdAt: new Date().toISOString(),
  };

  await ensureClassroomsDir();
  const filePath = path.join(CLASSROOMS_DIR, `${data.id}.json`);
  await writeJsonFileAtomic(filePath, classroomData);

  await syncToSupabase(classroomData);

  return {
    ...classroomData,
    url: `${baseUrl}/classroom/${data.id}`,
  };
}

// 增量写入：追加/更新 scenes（用于生成中每完成一个场景立即持久化）
export async function updateClassroomScenes(
  id: string,
  scenes: Scene[],
  stage?: Partial<Stage>,
): Promise<boolean> {
  if (!isSupabaseServerConfigured()) {
    log.debug('Supabase not configured, skipping scene update');
    return false;
  }

  const supabase = createSupabaseServerClient();
  if (!supabase) return false;

  try {
    const { data: existing } = await supabase
      .from('classrooms')
      .select('data, scene_count')
      .eq('id', id)
      .single();

    const existingScenes: Scene[] = existing?.data?.scenes || [];
    const sceneMap = new Map(existingScenes.map((s) => [s.id, s]));
    for (const s of scenes) sceneMap.set(s.id, s);
    const merged = Array.from(sceneMap.values()).sort((a, b) => a.order - b.order);

    const newStage = existing?.data?.stage
      ? { ...existing.data.stage, ...stage }
      : stage;
    const updatePayload: Record<string, unknown> = {
      data: {
        ...(existing?.data || {}),
        scenes: merged,
        stage: newStage,
      },
      scene_count: merged.length,
    };
    if (newStage && typeof newStage === 'object' && 'name' in newStage && newStage.name) {
      updatePayload.name = newStage.name;
    }
    if (newStage && typeof newStage === 'object' && 'language' in newStage) {
      updatePayload.language = newStage.language;
    }

    const { error } = await supabase
      .from('classrooms')
      .update(updatePayload)
      .eq('id', id);

    if (error) {
      log.error(`Failed to update scenes for classroom ${id}:`, error);
      return false;
    }

    try {
      const filePath = path.join(CLASSROOMS_DIR, `${id}.json`);
      const existingData = await readClassroom(id);
      if (existingData) {
        const updated = {
          ...existingData,
          scenes: merged,
          stage: { ...existingData.stage, ...(stage as Stage) },
        };
        await writeJsonFileAtomic(filePath, updated);
      }
    } catch {
      // 文件不存在或写入失败不影响主流程
    }

    log.info(`Updated ${scenes.length} scene(s) for classroom ${id} (total: ${merged.length})`);
    return true;
  } catch (err) {
    log.error(`Error updating scenes for classroom ${id}:`, err);
    return false;
  }
}

// 初始化课程：写入 stage + outlines（生成开始前调用）
export async function initClassroom(
  id: string,
  stage: Stage,
  outlines: unknown[],
  baseUrl: string,
): Promise<boolean> {
  const classroomData: PersistedClassroomData = {
    id,
    stage,
    scenes: [],
    createdAt: new Date().toISOString(),
  };

  // 写入本地文件
  await ensureClassroomsDir();
  const filePath = path.join(CLASSROOMS_DIR, `${id}.json`);
  await writeJsonFileAtomic(filePath, classroomData);

  // 写入 Supabase
  const result = await doSyncToSupabase({
    ...classroomData,
    data: {
      stage,
      scenes: [],
      outlines,
    },
  });

  if (result) {
    log.info(`Classroom ${id} initialized with ${outlines.length} outlines`);
  }
  return result;
}

// 内部：仅做 Supabase 写入，不操作本地文件（供 persistClassroom 和 initClassroom 复用）
async function doSyncToSupabase(classroomData: {
  id: string;
  data: { stage?: Stage; scenes: Scene[]; outlines?: unknown[] };
}): Promise<boolean> {
  if (!isSupabaseServerConfigured()) {
    log.debug('Supabase not configured, skipping sync');
    return false;
  }

  const supabase = createSupabaseServerClient();
  if (!supabase) return false;

  try {
    const { error } = await supabase.from('classrooms').upsert(
      {
        id: classroomData.id,
        name: classroomData.data.stage?.name || '',
        description: classroomData.data.stage?.description,
        language: classroomData.data.stage?.language || 'zh-CN',
        style: classroomData.data.stage?.style || 'interactive',
        data: classroomData.data,
        scene_count: classroomData.data.scenes?.length || 0,
        agent_ids:
          classroomData.data.stage?.agentIds ||
          classroomData.data.stage?.generatedAgentConfigs?.map((a: { id: string }) => a.id),
        requirements: (classroomData.data.stage as Stage & { requirements?: string })
          ?.requirements,
      },
      { onConflict: 'id' },
    );

    if (error) {
      log.error('Failed to sync classroom to Supabase:', error);
      return false;
    }
    log.info(`Classroom ${classroomData.id} synced to Supabase`);
    return true;
  } catch (err) {
    log.error('Error syncing to Supabase:', err);
    return false;
  }
}

async function syncToSupabase(classroomData: PersistedClassroomData): Promise<void> {
  await doSyncToSupabase({
    id: classroomData.id,
    data: {
      stage: classroomData.stage,
      scenes: classroomData.scenes,
    },
  });
}
