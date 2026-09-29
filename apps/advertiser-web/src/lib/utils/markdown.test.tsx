import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Markdown, parseMarkdownBlocks } from './markdown';

describe('Markdown (legal documents)', () => {
  it('parses headings, paragraphs, lists, quotes and rules', () => {
    const blocks = parseMarkdownBlocks(
      '# Title\n\nFirst paragraph\ncontinues here.\n\n- one\n- two\n\n1. first\n2. second\n\n> quoted\n\n---\n',
    );
    expect(blocks).toEqual([
      { type: 'heading', level: 1, text: 'Title' },
      { type: 'paragraph', text: 'First paragraph continues here.' },
      { type: 'list', ordered: false, items: ['one', 'two'] },
      { type: 'list', ordered: true, items: ['first', 'second'] },
      { type: 'quote', text: 'quoted' },
      { type: 'rule' },
    ]);
  });

  it('renders inline emphasis, links and bare URLs without injecting HTML', () => {
    render(
      <Markdown source={'Be **honest** and *fair*. See [terms](https://gize.app/legal) or https://gize.app/x.\n\n<script>alert(1)</script> literal'} />,
    );
    expect(screen.getByText('honest').tagName).toBe('STRONG');
    expect(screen.getByText('fair').tagName).toBe('EM');
    expect(screen.getByRole('link', { name: 'terms' })).toHaveAttribute('href', 'https://gize.app/legal');
    expect(screen.getByRole('link', { name: 'https://gize.app/x' })).toHaveAttribute('rel', 'noreferrer');
    expect(screen.getByText(/<script>alert\(1\)<\/script> literal/)).toBeInTheDocument();
    expect(document.querySelector('script')).toBeNull();
  });

  it('refuses unsafe link schemes', () => {
    render(<Markdown source="[bad](javascript:alert(1))" />);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('[bad](javascript:alert(1))')).toBeInTheDocument();
  });
});
