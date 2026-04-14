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
      stage: data.data.stage,
      scenes: data.data.scenes,
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

async function syncToSupabase(classroomData: PersistedClassroomData): Promise<void> {
  if (!isSupabaseServerConfigured()) {
    log.debug('Supabase not configured, skipping sync');
    return;
  }

  const supabase = createSupabaseServerClient();
  if (!supabase) return;

  try {
    const { error } = await supabase.from('classrooms').upsert({
      id: classroomData.id,
      name: classroomData.stage.name,
      description: classroomData.stage.description,
      language: classroomData.stage.language,
      style: classroomData.stage.style,
      data: {
        stage: classroomData.stage,
        scenes: classroomData.scenes,
      },
      scene_count: classroomData.scenes.length,
      agent_ids: classroomData.stage.agentIds || classroomData.stage.generatedAgentConfigs?.map(a => a.id),
      requirements: (classroomData.stage as Stage & { requirements?: string }).requirements,
      created_at: classroomData.createdAt,
    }, {
      onConflict: 'id',
    });

    if (error) {
      log.error('Failed to sync classroom to Supabase:', error);
    } else {
      log.info(`Classroom ${classroomData.id} synced to Supabase`);
    }
  } catch (err) {
    log.error('Error syncing to Supabase:', err);
  }
}
