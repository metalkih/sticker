import React from "react";
import { resourceUrlSchema } from "../../../server/contracts/resources.js";
function inline(value: string): React.ReactNode[] {
  const pattern =
    /(!?\[([^\]]*)\]\(([^\s)]+)\)|`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*)/g;
  const nodes: React.ReactNode[] = [];
  let end = 0;
  for (const match of value.matchAll(pattern)) {
    const start = match.index;
    nodes.push(value.slice(end, start));
    if (match[4]) nodes.push(<code key={start}>{match[4]}</code>);
    else if (match[5]) nodes.push(<strong key={start}>{match[5]}</strong>);
    else if (match[6]) nodes.push(<em key={start}>{match[6]}</em>);
    else if (
      !match[0].startsWith("!") &&
      resourceUrlSchema.safeParse(match[3]).success
    )
      nodes.push(
        <a
          key={start}
          href={match[3]}
          target="_blank"
          rel="noopener noreferrer"
        >
          {match[2]}
        </a>,
      );
    else nodes.push(match[0]);
    end = start + match[0].length;
  }
  nodes.push(value.slice(end));
  return nodes;
}
/** Deliberately inert Markdown subset: no HTML renderer, remote images or embeds. */
export function SafeMarkdown({ value }: { value: string }) {
  const lines = value.split(/\r?\n/),
    nodes: React.ReactNode[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i],
      heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (line.startsWith("```")) {
      const code: string[] = [];
      const start = i;
      while (++i < lines.length && !lines[i].startsWith("```"))
        code.push(lines[i]);
      nodes.push(
        <pre key={start}>
          <code>{code.join("\n")}</code>
        </pre>,
      );
    } else if (heading)
      nodes.push(
        React.createElement(
          `h${String(heading[1].length)}`,
          { key: i },
          inline(heading[2]),
        ),
      );
    else if (/^[-*]\s+/.test(line)) {
      const items: React.ReactNode[] = [];
      const start = i;
      do {
        items.push(<li key={i}>{inline(lines[i].replace(/^[-*]\s+/, ""))}</li>);
        i++;
      } while (i < lines.length && /^[-*]\s+/.test(lines[i]));
      i--;
      nodes.push(<ul key={start}>{items}</ul>);
    } else if (line.trim()) nodes.push(<p key={i}>{inline(line)}</p>);
  }
  return <div className="resource-markdown">{nodes}</div>;
}
