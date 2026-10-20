import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { findAnchor } from '../../src/lib/ui/anchors';
import { parsePageCounter } from '../../src/lib/ui/page-counter';

function load(name: string): Document {
  const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../fixtures', `${name}.html`), 'utf8');
  return new DOMParser().parseFromString(html, 'text/html');
}

describe('findAnchor', () => {
  it.each([
    ['github', 'github-overview', '[data-component="PageHeader.Description"]', { additions: 7, deletions: 3 }],
    ['github', 'github-commits', '[data-component="PageHeader.Description"]', { additions: 7, deletions: 3 }],
    ['github', 'github-files', '.gh-header-meta', { additions: 7, deletions: 3 }],
    ['gitlab', 'gitlab-overview', '.detail-page-description', null],
    ['gitlab', 'gitlab-commits', '.detail-page-description', null],
    ['gitlab', 'gitlab-files', '.detail-page-description', { additions: 9, deletions: 9 }],
  ] as const)('%s: resolves the anchor and counter of %s', (host, fixture, anchorSelector, counts) => {
    const doc = load(fixture);
    const found = findAnchor(host, doc);

    expect(found).not.toBeNull();
    expect(found!.anchor).toBe(doc.querySelector(anchorSelector));
    if (counts === null) {
      expect(found!.counter).toBeNull();
    } else {
      expect(found!.counter).not.toBeNull();
      expect(parsePageCounter(found!.counter!.textContent ?? '')).toEqual({ ...counts, capped: false });
    }
  });

  it('returns null for a document without PR/MR header markup', () => {
    const doc = new DOMParser().parseFromString('<html><body><h1>Hello</h1></body></html>', 'text/html');
    expect(findAnchor('github', doc)).toBeNull();
    expect(findAnchor('gitlab', doc)).toBeNull();
  });

  it('treats a climbed element without "+N −N" text as no counter', () => {
    const doc = new DOMParser().parseFromString(
      `<div data-component="PageHeader">
        <div data-component="PageHeader.Description"></div>
        <div data-component="PH_Navigation"><div><span>+7</span><span>-3</span>
          <div><div><div><div data-testid="addition diffstat"></div></div></div></div>
        </div></div>
      </div>`,
      'text/html',
    );

    const found = findAnchor('github', doc);

    expect(found?.anchor).toBe(doc.querySelector('[data-component="PageHeader.Description"]'));
    expect(found?.counter).toBeNull();
  });

  it('ignores a counter the browser reports as not rendered (GitLab keeps hidden tab panes in the DOM)', () => {
    const doc = load('gitlab-files');
    const counter = doc.querySelector('.diff-stats')!;
    Object.defineProperty(counter, 'checkVisibility', { value: () => false });

    const found = findAnchor('gitlab', doc);

    expect(found?.anchor).toBe(doc.querySelector('.detail-page-description'));
    expect(found?.counter).toBeNull();
  });
});
