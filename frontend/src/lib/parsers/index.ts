import type { ProviderStreamParser } from "@/lib/streamTypes";
import { ClaudeStreamParser }  from "./ClaudeStreamParser";
import { CodexStreamParser }   from "./CodexStreamParser";
import { OllamaStreamParser }  from "./OllamaStreamParser";

export function createParser(providerId: string): ProviderStreamParser {
  switch (providerId) {
    case "claude": return new ClaudeStreamParser();
    case "codex":  return new CodexStreamParser();
    case "ollama": return new OllamaStreamParser();
    case "gemini": return new ClaudeStreamParser(); // ANSI-capable fallback until dedicated parser
    default:       return new OllamaStreamParser(); // plain text fallback
  }
}

export { ClaudeStreamParser, CodexStreamParser, OllamaStreamParser };
