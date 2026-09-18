import type { Context } from "grammy";
import { permissionManager } from "../../app/managers/permission-manager.js";
import { getAlwaysAllowPermissions, setAlwaysAllowPermissions } from "../../app/stores/settings-store.js";

/**
 * Toggle the always-allow permissions mode on/off.
 * This setting is stored in settings.json and persists across restarts.
 * 
 * When enabled: the bot will automatically approve all permission requests
 * without prompting the user.
 * When disabled: the bot will show permission prompts as normal.
 */
export async function togglePermissionsCommand(ctx: Context): Promise<void> {
  // Toggle the setting in settings store
  const currentState = getAlwaysAllowPermissions();
  const newState = !currentState;
  setAlwaysAllowPermissions(newState);

  // If enabling, clear any active permission interactions
  if (newState) {
    permissionManager.clear();
  }

  const statusEmoji = newState ? "✅" : "🔓";
  const statusText = newState ? "diaktifkan" : "dinonaktifkan";
  const actionText = newState ? "semua permintaan izin akan diotorot otomatis" : "permintaan izin akan tampil kembali";

  await ctx.reply(
    `(${statusEmoji} Mode izin selalu ${statusText})\n\n${actionText}`,
    { disable_notification: true }
  );
}