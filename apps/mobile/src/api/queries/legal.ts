import type { Language } from '@rap/shared';
import { useQuery } from '@tanstack/react-query';

import { legalApi } from '@/api/endpoints/legal';
import { queryKeys } from '@/api/queryClient';

/** Current legal documents (terms + privacy) for the UI locale; public, cached for 10 minutes. */
export function useLegalDocuments(locale: Language, enabled = true) {
  return useQuery({
    queryKey: queryKeys.legal(locale),
    queryFn: () => legalApi.current(locale),
    enabled,
    staleTime: 10 * 60_000,
  });
}
