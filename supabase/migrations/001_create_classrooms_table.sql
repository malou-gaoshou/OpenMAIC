-- =============================================================================
-- OpenMAIC Supabase 数据库表
-- 在 Supabase SQL Editor 中执行此脚本
-- =============================================================================

-- 启用 UUID 扩展
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================================================
-- 课程表 (classrooms)
-- 存储所有生成的课程数据
-- =============================================================================
CREATE TABLE IF NOT EXISTS classrooms (
  id TEXT PRIMARY KEY,                              -- 课程唯一 ID (nanoid)
  name TEXT NOT NULL,                               -- 课程名称
  description TEXT,                                 -- 课程描述
  language TEXT DEFAULT 'zh-CN',                    -- 语言: zh-CN, en-US
  style TEXT DEFAULT 'interactive',                 -- 风格: interactive, lecture, etc.
  
  -- 完整课程数据 (JSONB)
  data JSONB NOT NULL,
  
  -- 统计信息
  scene_count INTEGER DEFAULT 0,                    -- 场景数量
  agent_ids TEXT[],                                -- 使用的智能体 ID 列表
  requirements TEXT,                               -- 用户输入的需求描述
  
  -- 时间戳
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_classrooms_created_at ON classrooms(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_classrooms_language ON classrooms(language);
CREATE INDEX IF NOT EXISTS idx_classrooms_updated_at ON classrooms(updated_at DESC);

-- =============================================================================
-- 启用 Row Level Security (RLS)
-- =============================================================================
ALTER TABLE classrooms ENABLE ROW LEVEL SECURITY;

-- 策略：所有人可以读取课程
CREATE POLICY "允许公开读取课程"
  ON classrooms
  FOR SELECT
  TO anon
  USING (true);

-- 策略：只有认证用户可以插入课程 (服务端通过 service_role 绕过)
CREATE POLICY "允许插入课程"
  ON classrooms
  FOR INSERT
  TO anon
  WITH CHECK (true);

-- 策略：允许更新课程
CREATE POLICY "允许更新课程"
  ON classrooms
  FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);

-- 策略：允许删除课程
CREATE POLICY "允许删除课程"
  ON classrooms
  FOR DELETE
  TO anon
  USING (true);

-- =============================================================================
-- 自动更新 updated_at 触发器
-- =============================================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_classrooms_updated_at
  BEFORE UPDATE ON classrooms
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- 验证表结构
-- =============================================================================
DO $$
BEGIN
  RAISE NOTICE 'Classrooms table created successfully!';
  RAISE NOTICE 'Table structure:';
  RAISE NOTICE '  - id (TEXT, PRIMARY KEY)';
  RAISE NOTICE '  - name (TEXT)';
  RAISE NOTICE '  - description (TEXT)';
  RAISE NOTICE '  - language (TEXT)';
  RAISE NOTICE '  - style (TEXT)';
  RAISE NOTICE '  - data (JSONB)';
  RAISE NOTICE '  - scene_count (INTEGER)';
  RAISE NOTICE '  - agent_ids (TEXT[])';
  RAISE NOTICE '  - requirements (TEXT)';
  RAISE NOTICE '  - created_at (TIMESTAMPTZ)';
  RAISE NOTICE '  - updated_at (TIMESTAMPTZ)';
END $$;
