import { QueryClientProvider } from '@tanstack/react-query';
import { MotionConfig } from 'framer-motion';
import { useState, type ReactNode } from 'react';
import { Toaster } from 'sonner';
import { TooltipProvider } from '@/components/ui/primitives';
import { useTheme } from '@/components/theme/theme-store';
import { AuthProvider } from '@/features/auth/auth-provider';
import { createQueryClient } from '@/lib/query/client';

function ThemedToaster() {
  const { resolved } = useTheme();
  return (
    <Toaster
      theme={resolved}
      position="bottom-right"
      richColors
      closeButton
      toastOptions={{
        classNames: {
          toast: '!rounded-md !border-border !bg-surface-elevated !text-fg !shadow-pop font-sans',
          description: '!text-fg-muted',
        },
      }}
    />
  );
}

export function AppProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(createQueryClient);
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <MotionConfig reducedMotion="user">
          <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
        </MotionConfig>
        <ThemedToaster />
      </AuthProvider>
    </QueryClientProvider>
  );
}
