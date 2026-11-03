import { useEffect } from 'react';

/** Calls `reload` every `ms` while the tab is visible (live pages: map, SOS). */
export function usePoll(reload: () => void, ms: number) {
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') reload();
    }, ms);
    return () => clearInterval(id);
  }, [reload, ms]);
}
