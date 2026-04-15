'use client';

import { Stage } from '@/components/stage';
import { ThemeProvider } from '@/lib/hooks/use-theme';
import { useStageStore } from '@/lib/store';
import { loadImageMapping } from '@/lib/utils/image-storage';
import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { useSceneGenerator } from '@/lib/hooks/use-scene-generator';
import { useMediaGenerationStore } from '@/lib/store/media-generation';
import { useWhiteboardHistoryStore } from '@/lib/store/whiteboard-history';
import { createLogger } from '@/lib/logger';
import { MediaStageProvider } from '@/lib/contexts/media-stage-context';
import { generateMediaForOutlines } from '@/lib/media/media-orchestrator';

const log = createLogger('Classroom');

export default function ClassroomDetailPage() {
  const params = useParams();
  const classroomId = params?.id as string;

  const { loadFromStorage } = useStageStore();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const generationStartedRef = useRef(false);

  // 只读模式：分享链接访问时不启用任何编辑/生成功能
  const isReadOnly = true;

  const { stop } = useSceneGenerator({
    onComplete: () => {
      log.info('[Classroom] All scenes generated, persisting to Supabase');
      persistCurrentClassroom().catch((err) => {
        log.warn('[Classroom] Final persist failed:', err);
      });
    },
    onSceneGenerated: (scene) => {
      log.info('[Classroom] Scene generated, incrementally saving:', scene.id);
      persistCurrentClassroom().catch((err) => {
        log.warn('[Classroom] Incremental persist failed:', err);
      });
    },
  });

  // 统一持久化函数：取当前 store 状态写入 Supabase
  const persistCurrentClassroom = useCallback(async () => {
    const state = useStageStore.getState();
    if (!state.stage) return;
    try {
      const res = await fetch('/api/classroom', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: state.stage!.id,
          scenes: state.scenes,
          stage: {
            name: state.stage!.name,
            language: state.stage!.language,
          },
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        log.warn('[Classroom] Persist failed:', err.error || res.status);
      } else {
        log.info('[Classroom] Persisted to Supabase');
      }
    } catch (err) {
      log.warn('[Classroom] Persist network error:', err);
    }
  }, []);

  const loadClassroom = useCallback(async () => {
    try {
      await loadFromStorage(classroomId);

      // If IndexedDB had no data, try server-side storage (API-generated classrooms)
      if (!useStageStore.getState().stage) {
        log.info('No IndexedDB data, trying server-side storage for:', classroomId);
        try {
          const res = await fetch(`/api/classroom?id=${encodeURIComponent(classroomId)}`);
          if (res.ok) {
            const json = await res.json();
            if (json.success && json.classroom) {
              const { stage, scenes, outlines } = json.classroom;
              useStageStore.getState().setStage(stage);
              useStageStore.setState({
                scenes,
                currentSceneId: scenes[0]?.id ?? null,
              });
              // Restore outlines so auto-resume can detect pending scenes
              if (outlines && outlines.length > 0) {
                useStageStore.getState().setOutlines(outlines);
              }
              log.info('Loaded from server-side storage:', classroomId, {
                scenes: scenes.length,
                outlines: outlines?.length ?? 0,
              });

              // Hydrate server-generated agents into IndexedDB + registry.
              if (stage.generatedAgentConfigs?.length) {
                const { saveGeneratedAgents } = await import('@/lib/orchestration/registry/store');
                await saveGeneratedAgents(stage.id, stage.generatedAgentConfigs);
                log.info('Hydrated server-generated agents for stage:', stage.id);
              }
            }
          }
        } catch (fetchErr) {
          log.warn('Server-side storage fetch failed:', fetchErr);
        }
      }

      // Restore completed media generation tasks from IndexedDB
      await useMediaGenerationStore.getState().restoreFromDB(classroomId);
      // Restore agents for this stage
      const { loadGeneratedAgentsForStage, useAgentRegistry } =
        await import('@/lib/orchestration/registry/store');
      const generatedAgentIds = await loadGeneratedAgentsForStage(classroomId);
      const { useSettingsStore } = await import('@/lib/store/settings');
      if (generatedAgentIds.length > 0) {
        // Auto mode — use generated agents from IndexedDB
        useSettingsStore.getState().setAgentMode('auto');
        useSettingsStore.getState().setSelectedAgentIds(generatedAgentIds);
      } else {
        // Preset mode — restore agent IDs saved in the stage at creation time.
        const stage = useStageStore.getState().stage;
        const stageAgentIds = stage?.agentIds;
        const registry = useAgentRegistry.getState();
        const cleanIds = stageAgentIds?.filter((id) => {
          const a = registry.getAgent(id);
          return a && !a.isGenerated;
        });
        useSettingsStore.getState().setAgentMode('preset');
        useSettingsStore
          .getState()
          .setSelectedAgentIds(
            cleanIds && cleanIds.length > 0 ? cleanIds : ['default-1', 'default-2', 'default-3'],
          );
      }
    } catch (error) {
      log.error('Failed to load classroom:', error);
      setError(error instanceof Error ? error.message : 'Failed to load classroom');
    } finally {
      setLoading(false);
    }
  }, [classroomId, loadFromStorage]);

  useEffect(() => {
    // Reset loading state on course switch to unmount Stage during transition,
    // preventing stale data from syncing back to the new course
    setLoading(true);
    setError(null);
    generationStartedRef.current = false;

    // Clear previous classroom's media tasks to prevent cross-classroom contamination.
    const mediaStore = useMediaGenerationStore.getState();
    mediaStore.revokeObjectUrls();
    useMediaGenerationStore.setState({ tasks: {} });

    // Clear whiteboard history to prevent snapshots from a previous course leaking in.
    useWhiteboardHistoryStore.getState().clearHistory();

    loadClassroom();

    // Cancel ongoing generation when classroomId changes or component unmounts
    return () => {
      stop();
    };
  }, [classroomId, loadClassroom, stop]);

  // 只读模式：禁用所有自动生成和重新生成功能
  useEffect(() => {
    if (loading || error || generationStartedRef.current) return;

    // 分享链接模式下不执行任何生成逻辑
    if (isReadOnly) {
      log.info('[Classroom] Read-only mode, skipping auto-resume');
      return;
    }

    const state = useStageStore.getState();
    const { outlines, scenes, stage } = state;

    // Check if there are pending outlines
    const completedOrders = new Set(scenes.map((s) => s.order));
    const hasPending = outlines.some((o) => !completedOrders.has(o.order));

    if (hasPending && stage) {
      generationStartedRef.current = true;

      // Load generation params from sessionStorage (stored by generation-preview before navigating)
      const genParamsStr = sessionStorage.getItem('generationParams');
      const params = genParamsStr ? JSON.parse(genParamsStr) : {};

      // Reconstruct imageMapping from IndexedDB using pdfImages storageIds
      const storageIds = (params.pdfImages || [])
        .map((img: { storageId?: string }) => img.storageId)
        .filter(Boolean);

      const { generateRemaining } = useSceneGenerator.getState?.() || {};
      if (generateRemaining) {
        loadImageMapping(storageIds).then((imageMapping) => {
          generateRemaining({
            pdfImages: params.pdfImages,
            imageMapping,
            stageInfo: {
              name: stage.name || '',
              description: stage.description,
              language: stage.language,
              style: stage.style,
            },
            agents: params.agents,
            userProfile: params.userProfile,
          });
        });
      }
    } else if (outlines.length > 0 && stage) {
      // All scenes are generated, but some media may not have finished.
      const genParamsStr = sessionStorage.getItem('generationParams');
      if (!genParamsStr) {
        log.info('[Classroom] Shared link access, skipping auto-resume');
        return;
      }
      generationStartedRef.current = true;
      generateMediaForOutlines(outlines, stage.id).catch((err) => {
        log.warn('[Classroom] Media generation resume error:', err);
      });
    }
  }, [loading, error, isReadOnly]);

  return (
    <ThemeProvider>
      <MediaStageProvider value={classroomId}>
        <div className="h-screen flex flex-col overflow-hidden">
          {loading ? (
            <div className="flex-1 flex items-center justify-center bg-gray-50 dark:bg-gray-900">
              <div className="text-center text-muted-foreground">
                <p>Loading classroom...</p>
              </div>
            </div>
          ) : error ? (
            <div className="flex-1 flex items-center justify-center bg-gray-50 dark:bg-gray-900">
              <div className="text-center">
                <p className="text-destructive mb-4">Error: {error}</p>
                <button
                  onClick={() => {
                    setError(null);
                    setLoading(true);
                    loadClassroom();
                  }}
                  className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
                >
                  Retry
                </button>
              </div>
            </div>
          ) : (
            <Stage isReadOnly={isReadOnly} />
          )}
        </div>
      </MediaStageProvider>
    </ThemeProvider>
  );
}
