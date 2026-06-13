import { opencodeClient } from "../../opencode/client.js";

export interface CommandCatalogItem {
  name: string;
  description?: string;
}

function normalizeDirectoryForCommandApi(directory: string): string {
  return directory.replace(/\\/g, "/");
}

export async function loadCommandCatalog(projectDirectory: string): Promise<CommandCatalogItem[]> {
  const { data, error } = await opencodeClient.command.list({
    directory: normalizeDirectoryForCommandApi(projectDirectory),
  });

  if (error || !data) {
    throw error || new Error("No command data received");
  }

  return data
    .filter((command) => {
      const source = (command as { source?: unknown }).source;
      return (
        typeof command.name === "string" && command.name.trim().length > 0 && source === "command"
      );
    })
    .map((command) => ({
      name: command.name,
      description: command.description,
    }));
}
