export type SkillBuilderTrigger = {
  type: string;
  value: string;
  weight?: number;
};

export type SkillBuilderDraft = {
  name: string;
  slug: string;
  scope: string;
  activationMode: string;
  triggers: SkillBuilderTrigger[];
  enabled: boolean;
  showInSlash: boolean;
  markdown: string;
};

function fencedBlock(content: string, language: string): string | null {
  const re = new RegExp("(`{3,}|~{3,})" + language + "\\s*\\n([\\s\\S]*?)\\n\\1", "i");
  return content.match(re)?.[2]?.trim() ?? null;
}

function normalizeSlug(value: string): string {
  return value
    .trim()
    .replace(/^\/+/, "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function titleFromMarkdown(markdown: string): string {
  const frontmatterName = markdown.match(/^---[\s\S]*?\nname:\s*["']?([^"'\n]+)["']?/i)?.[1]?.trim();
  if (frontmatterName) return frontmatterName;
  const heading = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return heading || "Generated Skill";
}

function settingsFromJson(content: string): Partial<SkillBuilderDraft> | null {
  const block = fencedBlock(content, "json");
  if (!block) return null;
  try {
    const parsed = JSON.parse(block) as Partial<SkillBuilderDraft>;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export function parseSkillBuilderDraft(content: string): SkillBuilderDraft | null {
  const markdown = fencedBlock(content, "markdown") ?? fencedBlock(content, "md");
  if (!markdown || !/---[\s\S]*?name:/i.test(markdown)) return null;
  const settings = settingsFromJson(content) ?? {};
  const name = String(settings.name || titleFromMarkdown(markdown)).trim();
  const slug = normalizeSlug(String(settings.slug || name));
  if (!name || !slug) return null;
  return {
    name,
    slug,
    scope: String(settings.scope || "global"),
    activationMode: String(settings.activationMode || "manual"),
    triggers: Array.isArray(settings.triggers) ? settings.triggers : [],
    enabled: settings.enabled ?? false,
    showInSlash: settings.showInSlash ?? false,
    markdown,
  };
}

export function skillDraftImportPayload(draft: SkillBuilderDraft) {
  return {
    name: draft.name,
    slug: draft.slug,
    markdown: draft.markdown,
    scope: draft.scope,
    activationMode: draft.activationMode,
    triggers: draft.triggers,
    enabled: draft.enabled,
    showInSlash: draft.showInSlash,
  };
}
