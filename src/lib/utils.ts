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
 * Replace environment variables in a string with their values
 * @param text The text containing {{variable}} placeholders
 * @param envVars Array of environment variables
 * @returns The text with variables replaced by their values
 */
export function processEnvVars(text: string, envVars: { key: string; value: string }[]): string {
  if (!text || !envVars || envVars.length === 0) return text;
  
  const varMap = new Map(envVars.map(v => [v.key, v.value]));
  
  return text.replace(/\{\{([^}]+)\}\}/g, (match, varName) => {
    const value = varMap.get(varName);
    return value !== undefined ? value : match; // Keep original if var not found
  });
}

/**
 * Stub for exporting JSON data to XLSX.
 */
export function exportToXLSX(data: any[]) {
  // Implementation would convert `data` to an XLSX file and trigger download.
  console.log('Export to XLSX:', data);
} 