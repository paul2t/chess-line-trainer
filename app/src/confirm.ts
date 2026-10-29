import { reactive } from 'vue';

/** In-page replacements for window.confirm / prompt (blocked in sandboxed pages). */
export const confirmState = reactive({
  open: false, title: '', body: '', ok: 'OK', input: null as string | null,
  resolve: null as null | ((v: boolean) => void),
});

export function askConfirm(title: string, body = '', ok = 'OK'): Promise<boolean> {
  return new Promise((resolve) => Object.assign(confirmState, { open: true, title, body, ok, input: null, resolve }));
}

/** Ask for a text; resolves null if cancelled. */
export function askText(title: string, initial = '', ok = 'Save'): Promise<string | null> {
  return new Promise((resolve) => {
    Object.assign(confirmState, {
      open: true, title, body: '', ok, input: initial,
      resolve: (v: boolean) => resolve(v ? (confirmState.input ?? '').trim() || null : null),
    });
  });
}

export function answerConfirm(v: boolean) {
  confirmState.resolve?.(v);
  Object.assign(confirmState, { open: false, resolve: null });
}
