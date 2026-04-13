'use client';

import { useEffect, useState, ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { AccessCodeModal } from '@/components/access-code-modal';

export function AccessCodeGuard({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [status, setStatus] = useState<{
    enabled: boolean;
    authenticated: boolean;
    loading: boolean;
  }>({ enabled: false, authenticated: false, loading: true });

  // 教室页面和公开分享页面不需要访问码验证
  const isClassroomPage = pathname?.startsWith('/classroom/');
  const skipAuth = isClassroomPage;

  useEffect(() => {
    if (skipAuth) {
      setStatus({ enabled: false, authenticated: true, loading: false });
      return;
    }

    let cancelled = false;
    fetch('/api/access-code/status')
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) {
          setStatus({
            enabled: data.enabled,
            authenticated: data.authenticated,
            loading: false,
          });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setStatus({ enabled: true, authenticated: false, loading: false });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [skipAuth]);

  const needsAuth = !status.loading && status.enabled && !status.authenticated;

  return (
    <>
      {needsAuth && (
        <AccessCodeModal
          open={true}
          onSuccess={() => setStatus((s) => ({ ...s, authenticated: true }))}
        />
      )}
      {children}
    </>
  );
}
