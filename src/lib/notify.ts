import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";

let permissionGranted = false;

/** Call once at startup. Fail open: denied or errored → notify() is just a
 * no-op from then on, never blocks anything else. */
export async function initNotifications(): Promise<void> {
  try {
    permissionGranted = await isPermissionGranted();
    if (!permissionGranted) {
      permissionGranted = (await requestPermission()) === "granted";
    }
  } catch {
    permissionGranted = false;
  }
}

export function notify(title: string, body?: string): void {
  if (!permissionGranted) return;
  try {
    sendNotification({ title, body });
  } catch {
    // fail open — a notification failure must never affect terminals
  }
}
