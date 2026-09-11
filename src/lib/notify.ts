import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";

let permissionGranted = false;

/** Warm the permission cache at startup without prompting. Fail open: denied
 * or errored means notify() remains a no-op. */
export async function initNotifications(): Promise<boolean> {
  try {
    permissionGranted = await isPermissionGranted();
    return permissionGranted;
  } catch {
    permissionGranted = false;
    return false;
  }
}

/** The only OS permission-request path. Call from an explicit user action. */
export async function requestNotifications(): Promise<boolean> {
  try {
    permissionGranted = await isPermissionGranted();
    if (!permissionGranted) permissionGranted = (await requestPermission()) === "granted";
    return permissionGranted;
  } catch {
    permissionGranted = false;
    return false;
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
