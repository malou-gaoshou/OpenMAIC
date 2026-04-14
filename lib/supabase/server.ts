import { createClient } from '@supabase/supabase-js';
import type { Stage, Scene } from '@/lib/types/stage';
import { createLogger } from '@/lib/logger';

const log = createLogger('SupabaseServer');

function getSupabaseConfig() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    log.warn('Supabase service credentials not fully configured');
  }

  return { supabaseUrl, supabaseServiceKey };
}

export function createSupabaseServerClient() {
  const { supabaseUrl, supabaseServiceKey } = getSupabaseConfig();

  if (!supabaseUrl || !supabaseServiceKey) {
    return null;
  }

  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export function isSupabaseServerConfigured(): boolean {
  const { supabaseUrl, supabaseServiceKey } = getSupabaseConfig();
  return Boolean(supabaseUrl && supabaseServiceKey);
}

export interface ClassroomData {
  id: string;
  name: string;
  description?: string;
  language?: string;
  style?: string;
  data: {
    stage: Stage;
    scenes: Scene[];
  };
  scene_count: number;
  agent_ids?: string[];
  requirements?: string;
  created_at: string;
  updated_at: string;
}

export interface ClassroomListItem {
  id: string;
  name: string;
  description?: string;
  language?: string;
  style?: string;
  scene_count: number;
  agent_ids?: string[];
  requirements?: string;
  created_at: string;
  updated_at: string;
}
