import { opencodeClient } from "../../opencode/client.js";

export interface SkillCatalogItem {
  name: string;
  description?: string | undefined;
}

function normalizeDirectoryForCommandApi(directory: string): string {
  return directory.replace(/\\/g, "/");
}

export async function loadSkillsCatalog(projectDirectory: string): Promise<SkillCatalogItem[]> {
  const { data, error } = await opencodeClient.command.list({
    directory: normalizeDirectoryForCommandApi(projectDirectory),
  });

  if (error || !data) {
    throw error || new Error("No skill data received");
  }

  return data
    .filter((skill) => {
      return typeof skill.name === "string" && skill.name.trim().length > 0 && skill.source === "skill";
    })
    .map((skill) => ({
      name: skill.name,
      description: skill.description,
    }));
}
