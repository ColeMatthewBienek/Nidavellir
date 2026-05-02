import { describe, expect, it } from "vitest";
import { parseSkillBuilderDraft, skillDraftImportPayload } from "../skillBuilderDraft";

describe("parseSkillBuilderDraft", () => {
  it("extracts settings and skill markdown from skill-builder output", () => {
    const draft = parseSkillBuilderDraft(`
Ready to create it.

\`\`\`json
{"name":"Review Helper","slug":"review-helper","scope":"project","activationMode":"automatic","triggers":[{"type":"keyword","value":"review","weight":1}],"enabled":true,"showInSlash":true}
\`\`\`

\`\`\`markdown
---
name: review-helper
description: Review code.
---

# Review Helper

Review code carefully.
\`\`\`
`);

    expect(draft).toMatchObject({
      name: "Review Helper",
      slug: "review-helper",
      scope: "project",
      activationMode: "automatic",
      enabled: true,
      showInSlash: true,
    });
    expect(draft?.triggers).toEqual([{ type: "keyword", value: "review", weight: 1 }]);
    expect(skillDraftImportPayload(draft!)).toMatchObject({
      slug: "review-helper",
      markdown: expect.stringContaining("# Review Helper"),
    });
  });

  it("supports larger markdown fences when the skill contains code fences", () => {
    const draft = parseSkillBuilderDraft(`
\`\`\`json
{"name":"Code Skill","slug":"code-skill"}
\`\`\`

\`\`\`\`markdown
---
name: code-skill
description: Includes examples.
---

# Code Skill

\`\`\`text
literal nested fence
\`\`\`
\`\`\`\`
`);

    expect(draft?.markdown).toContain("```text\nliteral nested fence\n```");
  });
});
