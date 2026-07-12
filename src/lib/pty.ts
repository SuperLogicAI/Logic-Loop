import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export function ptySpawn(cwd: string | null, cols: number, rows: number): Promise<number> {
  return invoke<number>("pty_spawn", { cwd, cols, rows });
}

export function ptyWrite(id: number, data: string): Promise<void> {
  return invoke("pty_write", { id, data });
}

export function ptyResize(id: number, cols: number, rows: number): Promise<void> {
  return invoke("pty_resize", { id, cols, rows });
}

export function ptyKill(id: number): Promise<void> {
  return invoke("pty_kill", { id });
}

export function ptyLiveCount(): Promise<number> {
  return invoke<number>("pty_live_count");
}

export function ptyKillAll(): Promise<void> {
  return invoke("pty_kill_all");
}

export function onPtyOutput(id: number, cb: (data: Uint8Array) => void): Promise<UnlistenFn> {
  return listen<string>(`pty://output/${id}`, (e) => {
    const raw = atob(e.payload);
    const bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0));
    cb(bytes);
  });
}

export function onPtyExit(id: number, cb: () => void): Promise<UnlistenFn> {
  return listen(`pty://exit/${id}`, () => cb());
}
