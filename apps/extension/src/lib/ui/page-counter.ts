import type { Breakdown } from '@diffspoiler/core/types';

export interface PageCounter {
  additions: number | null;
  deletions: number | null;
  capped: boolean;
}

const toNumber = (digits: string): number => Number(digits.replace(/\D/g, ''));

export function parsePageCounter(text: string): PageCounter {
  const add = /\+\s*(\d[\d,.\s  ]*)/.exec(text);
  const del = /[−-]\s*(\d[\d,.\s  ]*)/.exec(text);
  if (add?.[1] && del?.[1]) {
    return { additions: toNumber(add[1]), deletions: toNumber(del[1]), capped: false };
  }
  // "1000+" style counters: the platform stopped counting.
  const capped = /\d\s*\+(?!\s*\d)/.test(text);
  return { additions: null, deletions: null, capped };
}

const fmt = (n: number): string => n.toLocaleString('en-US');

export function footnote(b: Breakdown, page: PageCounter | null): string | null {
  if (!page) return null;
  if (page.capped) return 'The page shows a capped count; diffspoiler counted every changed file.';
  if (page.additions === null || page.deletions === null) return null;
  if (page.additions === b.total.additions && page.deletions === b.total.deletions) return null;
  return (
    `The page shows +${fmt(page.additions)} −${fmt(page.deletions)}; ` +
    `diffspoiler counted +${fmt(b.total.additions)} −${fmt(b.total.deletions)} across all files.`
  );
}
