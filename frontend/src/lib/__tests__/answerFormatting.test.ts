import { describe, expect, it } from "vitest";
import { formatAssistantAnswer } from "../answerFormatting";

describe("formatAssistantAnswer", () => {
  it("promotes inline numbered questions into markdown headings", () => {
    const formatted = formatAssistantAnswer(
      "Some setup text. Question 4: What's your database preference?",
    );

    expect(formatted).toBe("Some setup text.\n\n### Question 4: What's your database preference?");
  });

  it("turns important constraint paragraphs into callouts", () => {
    const formatted = formatAssistantAnswer(
      "Important constraint to surface before Question 4: Render spins down after inactivity.\n\nQuestion 4: Database?",
    );

    expect(formatted).toBe(
      "> **Important constraint:** Render spins down after inactivity.\n\n### Question 4: Database?",
    );
  });

  it("does not rewrite code fences", () => {
    const content = "```md\nQuestion 4: keep literal\n```\n\nQuestion 5: promote this";

    expect(formatAssistantAnswer(content)).toBe("```md\nQuestion 4: keep literal\n```\n\n### Question 5: promote this");
  });
});
