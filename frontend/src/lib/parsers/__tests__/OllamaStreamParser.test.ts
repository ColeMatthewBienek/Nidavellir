import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { OllamaStreamParser } from "../OllamaStreamParser";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => readFileSync(join(__dirname, "fixtures", name), "utf8");

describe("OllamaStreamParser", () => {
  it("keeps fragmented think blocks out of visible answer text", () => {
    const parser = new OllamaStreamParser();
    const chunks = JSON.parse(fixture("ollama-think-fragmented.json")) as string[];
    const events = chunks.flatMap((chunk) => parser.feed(chunk));

    expect(events).toContainEqual({ type: "answer_delta", content: "I will answer after thinking. " });
    expect(events).toContainEqual({ type: "reasoning_signal", content: "private chain\nof thought" });
    expect(events).toContainEqual({ type: "answer_delta", content: "Final answer." });
    expect(events.some((event) => event.type === "answer_delta" && event.content.includes("private chain"))).toBe(false);
  });
});
