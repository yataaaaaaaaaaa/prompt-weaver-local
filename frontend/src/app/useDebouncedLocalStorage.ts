import { useEffect, useRef } from 'react';
import { createFileBackedStorage } from '../utils/createFileBackedStorage';

export function useDebouncedLocalStorage(key: string, value: string | null, delayMs = 150) {
  const timerRef = useRef<number | null>(null);
  const lastSavedValueRef = useRef('');

  useEffect(() => {
    if (value == null) {
      return;
    }
    if (value === lastSavedValueRef.current) {
      return;
    }
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
    }
    timerRef.current = window.setTimeout(() => {
      void createFileBackedStorage('debounced-state').setItem(key, value);
      lastSavedValueRef.current = value;
    }, delayMs);
    return () => {
      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
      }
    };
  }, [delayMs, key, value]);

  return lastSavedValueRef;
}
