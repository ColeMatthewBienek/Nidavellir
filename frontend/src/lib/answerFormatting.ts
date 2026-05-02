const CALLOUT_PREFIX_RE = /^(Important constraint|Constraint|Caveat|Note|Heads up)(?:\s+to\s+surface)?(?:\s+before\s+Question\s+\d+)?\s*:?\s*/i;
const QUESTION_RE = /(?:^|\n|(?<=[.!?])\s+)(Question\s+\d+\s*:)/g;

function fencedRanges(content: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  const re = /```[\s\S]*?```/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(content)) !== null) {
    ranges.push([match.index, match.index + match[0].length]);
  }
  return ranges;
}

function insideRange(index: number, ranges: Array<[number, number]>): boolean {
  return ranges.some(([start, end]) => index >= start && index < end);
}

function promoteQuestions(content: string): string {
  const ranges = fencedRanges(content);
  return content.replace(QUESTION_RE, (match, label: string, offset: number) => {
    const questionOffset = offset + match.indexOf(label);
    if (insideRange(questionOffset, ranges)) return match;
    const prefix = match.startsWith("\n") ? "\n\n" : match.trimStart() !== match ? " \n\n" : "";
    return `${prefix}### ${label}`;
  });
}

function formatCalloutParagraph(paragraph: string): string {
  const match = paragraph.match(CALLOUT_PREFIX_RE);
  if (!match) return paragraph;
  const label = match[1].toLowerCase() === "heads up" ? "Note" : match[1];
  const body = paragraph.slice(match[0].length).trim();
  if (!body) return paragraph;
  return `> **${label}:** ${body}`;
}

export function formatAssistantAnswer(content: string): string {
  if (!content.trim()) return content;
  const questionFormatted = promoteQuestions(content);
  return questionFormatted
    .split(/\n{2,}/)
    .map((paragraph) => formatCalloutParagraph(paragraph.trimEnd()))
    .join("\n\n");
}
