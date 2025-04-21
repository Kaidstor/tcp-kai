import { sendNotification, requestPermission, isPermissionGranted } from '@tauri-apps/plugin-notification';

/**
 * Display a desktop notification via Tauri
 */
export async function notification(title: string, body: string) {
   try {
    // Do you have permission to send a notification?
    let permissionGranted = await isPermissionGranted();

    // If not we need to request it
    if (!permissionGranted) {
      const permission = await requestPermission();
      permissionGranted = permission === "granted";
    }

    // Once permission has been granted we can send the notification
    if (permissionGranted) {
      sendNotification({ title, body });
    }
  } catch (e) {
    console.error("Notification error:", e);
  }
}

/**
 * Stub for exporting JSON data to XLSX.
 */
export function exportToXLSX(data: any[]) {
  // Implementation would convert `data` to an XLSX file and trigger download.
  console.log('Export to XLSX:', data);
} 