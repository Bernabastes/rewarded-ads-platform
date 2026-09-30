import { Fragment, type ReactNode } from 'react';
import { cn } from './cn';

/**
 * Minimal, dependency-free Markdown renderer for the legal documents served by `GET /legal/current`
 * (`contentMarkdown`). Supports headings, paragraphs, bullet / numbered lists, blockquotes, horizontal rules,
 * **bold**, *italic*, `code`, [links](url) and bare URLs. Raw HTML is rendered as text (never injected), so the
 * output is safe for server-provided content.
 */

type Block =
  | { type: 'heading'; level: number; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'quote'; text: string }
  | { type: 'rule' };

export function parseMarkdownBlocks(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let quote: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length) blocks.push({ type: 'paragraph', text: paragraph.join(' ') });
    paragraph = [];
  };
  const flushList = () => {
    if (list) blocks.push({ type: 'list', ...list });
    list = null;
  };
  const flushQuote = () => {
    if (quote.length) blocks.push({ type: 'quote', text: quote.join(' ') });
    quote = [];
  };
  const flushAll = () => {
    flushParagraph();
    flushList();
    flushQuote();
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flushAll();
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushAll();
      blocks.push({ type: 'heading', level: heading[1].length, text: heading[2].trim() });
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      flushAll();
      blocks.push({ type: 'rule' });
      continue;
    }
    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      flushParagraph();
      flushQuote();
      const ordered = !!numbered;
      const text = (bullet ?? numbered)![1];
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { ordered, items: [] };
      }
      list.items.push(text);
      continue;
    }
    const quoted = /^\s*>\s?(.*)$/.exec(line);
    if (quoted) {
      flushParagraph();
      flushList();
      quote.push(quoted[1]);
      continue;
    }
    if (list) {
      // Lazy continuation of the previous list item.
      list.items[list.items.length - 1] += ` ${line.trim()}`;
      continue;
    }
    flushQuote();
    paragraph.push(line.trim());
  }
  flushAll();
  return blocks;
}

const INLINE_PATTERN =
  /(\*\*[^*]+\*\*|__[^_]+__|\*[^*\s][^*]*\*|_[^_\s][^_]*_|`[^`]+`|\[[^\]]+\]\([^)\s]+\)|https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/g;

function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const match of text.matchAll(INLINE_PATTERN)) {
    const index = match.index ?? 0;
    if (index > last) nodes.push(text.slice(last, index));
    const token = match[0];
    key += 1;
    if (token.startsWith('**') || token.startsWith('__')) {
      nodes.push(<strong key={key}>{renderInline(token.slice(2, -2))}</strong>);
    } else if (token.startsWith('`')) {
      nodes.push(
        <code key={key} className="rounded-sm bg-surface-muted px-1 py-0.5 font-mono text-[0.9em]">
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith('[')) {
      const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(token);
      if (link && isSafeHref(link[2])) {
        nodes.push(
          <a key={key} href={link[2]} target="_blank" rel="noreferrer" className="font-medium text-primary underline-offset-4 hover:underline">
            {renderInline(link[1])}
          </a>,
        );
      } else {
        nodes.push(token);
      }
    } else if (token.startsWith('http')) {
      nodes.push(
        <a key={key} href={token} target="_blank" rel="noreferrer" className="break-all font-medium text-primary underline-offset-4 hover:underline">
          {token}
        </a>,
      );
    } else {
      nodes.push(<em key={key}>{renderInline(token.slice(1, -1))}</em>);
    }
    last = index + token.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function isSafeHref(href: string): boolean {
  return /^(https?:\/\/|mailto:|\/)/i.test(href);
}

export function Markdown({ source, className }: { source: string; className?: string }) {
  const blocks = parseMarkdownBlocks(source);
  return (
    <div className={cn('markdown flex flex-col gap-3 text-sm leading-relaxed text-fg', className)}>
      {blocks.map((block, index) => {
        switch (block.type) {
          case 'heading': {
            const level = Math.min(4, Math.max(1, block.level));
            const Tag = `h${level}` as 'h1' | 'h2' | 'h3' | 'h4';
            const sizes = {
              1: 'text-xl font-bold',
              2: 'text-lg font-semibold',
              3: 'text-base font-semibold',
              4: 'text-sm font-semibold uppercase tracking-wide text-fg-muted',
            } as const;
            return (
              <Tag key={index} className={cn('text-display mt-2 first:mt-0', sizes[level as 1 | 2 | 3 | 4])}>
                {renderInline(block.text)}
              </Tag>
            );
          }
          case 'paragraph':
            return <p key={index}>{renderInline(block.text)}</p>;
          case 'list': {
            const Tag = block.ordered ? 'ol' : 'ul';
            return (
              <Tag key={index} className={cn('flex flex-col gap-1 pl-5', block.ordered ? 'list-decimal' : 'list-disc')}>
                {block.items.map((item, i) => (
                  <li key={i}>{renderInline(item)}</li>
                ))}
              </Tag>
            );
          }
          case 'quote':
            return (
              <blockquote key={index} className="border-l-2 border-border-strong pl-3 text-fg-muted italic">
                {renderInline(block.text)}
              </blockquote>
            );
          case 'rule':
            return <hr key={index} className="border-border" />;
          default:
            return <Fragment key={index} />;
        }
      })}
    </div>
  );
}
