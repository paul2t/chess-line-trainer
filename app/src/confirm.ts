import { reactive } from 'vue';

/** In-page replacement for window.confirm (blocked in sandboxed pages). */
export const confirmState = reactive({ open: false, title: '', body: '', ok: 'OK', resolve: null as null | ((v: boolean) => void) });

export function askConfirm(title: string, body = '', ok = 'OK'): Promise<boolean> {
  return new Promise((resolve) => Object.assign(confirmState, { open: true, title, body, ok, resolve }));
}

export function answerConfirm(v: boolean) {
  confirmState.resolve?.(v);
  Object.assign(confirmState, { open: false, resolve: null });
}
