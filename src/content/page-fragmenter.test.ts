import { describe, expect, it } from 'vitest';

import type { PageToken } from './page-dom-parser';
import { createPageFragmentPlan } from './page-fragmenter';

function tokenMap(...entries: Array<[string, PageToken['kind']]>): Map<string, PageToken> {
  return new Map(entries.map(([id, kind]) => [id, { id, kind }]));
}

describe('createPageFragmentPlan', () => {
  it('returns a single input exactly as provided', () => {
    const input = '  Keep  repeated spaces\nand a newline.  ';

    expect(createPageFragmentPlan(input, input, new Map(), 100)).toEqual({
      fragments: [input],
      joiners: [],
      preserveStructure: true,
    });
  });

  it('prefers sentence, newline and whitespace boundaries and records their joiners', () => {
    const input = 'First sentence. Second\nThird word';

    const plan = createPageFragmentPlan(input, input, new Map(), 16);

    expect(plan).toEqual({
      fragments: ['First sentence.', 'Second', 'Third word'],
      joiners: [' ', '\n'],
      preserveStructure: true,
    });
  });

  it('keeps multiple balanced inline spans structurally intact', () => {
    const open0 = '{{NIRA_TAG_0_START}}';
    const close0 = '{{NIRA_TAG_0_END}}';
    const open1 = '{{NIRA_TAG_1_START}}';
    const close1 = '{{NIRA_TAG_1_END}}';
    const serialized = `${open0}Alpha words${close0} ${open1}Beta words${close1}`;
    const tokens = tokenMap(
      [open0, 'open'],
      [close0, 'close'],
      [open1, 'open'],
      [close1, 'close'],
    );

    const plan = createPageFragmentPlan(serialized, 'Alpha words Beta words', tokens, 55);

    expect(plan.fragments).toEqual([
      `${open0}Alpha words${close0}`,
      `${open1}Beta words${close1}`,
    ]);
    expect(plan.joiners).toEqual([' ']);
    expect(plan.preserveStructure).toBe(true);
    expect(plan.fragments.every((fragment) => fragment.length <= 55)).toBe(true);
  });

  it('falls back to plain source when a nested inline span is too long to balance', () => {
    const open0 = '{{NIRA_TAG_0_START}}';
    const close0 = '{{NIRA_TAG_0_END}}';
    const open1 = '{{NIRA_TAG_1_START}}';
    const close1 = '{{NIRA_TAG_1_END}}';
    const source = 'x'.repeat(70);
    const serialized = `${open0}${open1}${source}${close1}${close0}`;
    const tokens = tokenMap(
      [open0, 'open'],
      [close0, 'close'],
      [open1, 'open'],
      [close1, 'close'],
    );

    const plan = createPageFragmentPlan(serialized, source, tokens, 40);

    expect(plan.preserveStructure).toBe(false);
    expect(plan.fragments.join('')).toBe(source);
    expect(plan.joiners).toEqual(['']);
    expect(plan.fragments.every((fragment) => fragment.length <= 40)).toBe(true);
  });

  it('falls back when generated tag tokens are misordered', () => {
    const open0 = '{{NIRA_TAG_0_START}}';
    const close0 = '{{NIRA_TAG_0_END}}';
    const open1 = '{{NIRA_TAG_1_START}}';
    const close1 = '{{NIRA_TAG_1_END}}';
    const malformed = `${open0}${open1}words${close0}${close1}`;
    const tokens = tokenMap(
      [open0, 'open'],
      [close0, 'close'],
      [open1, 'open'],
      [close1, 'close'],
    );

    expect(createPageFragmentPlan(malformed, 'plain words', tokens, 200)).toEqual({
      fragments: ['plain words'],
      joiners: [],
      preserveStructure: false,
    });
  });

  it('uses UTF-16 lengths without splitting emoji surrogate pairs when avoidable', () => {
    const input = '\ud83d\ude00'.repeat(5);

    const plan = createPageFragmentPlan(input, input, new Map(), 3);

    expect(plan.fragments).toEqual(['\ud83d\ude00', '\ud83d\ude00', '\ud83d\ude00', '\ud83d\ude00', '\ud83d\ude00']);
    expect(plan.joiners).toEqual(['', '', '', '']);
    expect(plan.fragments.every((fragment) => fragment.length <= 3)).toBe(true);
    expect(plan.fragments.join('')).toBe(input);
  });

  it('preserves exact preformatted whitespace in fragment joiners', () => {
    const input = 'first line\n\n    indented second line';

    const plan = createPageFragmentPlan(input, input, new Map(), 14);

    expect(plan.fragments.length).toBeGreaterThan(1);
    expect(plan.joiners).toContain('\n\n    ');
    let rebuilt = plan.fragments[0] ?? '';
    for (let index = 1; index < plan.fragments.length; index += 1) {
      rebuilt += `${plan.joiners[index - 1] ?? ''}${plan.fragments[index] ?? ''}`;
    }
    expect(rebuilt).toBe(input);
  });

  it('never cuts an atomic token and falls back if the token exceeds the limit', () => {
    const atomic = '{{NIRA_ATOMIC_0}}';
    const tokens = tokenMap([atomic, 'atomic']);

    const plan = createPageFragmentPlan(`Before${atomic}After`, 'Before image After', tokens, 12);

    expect(plan.preserveStructure).toBe(false);
    expect(plan.fragments.every((fragment) => fragment.length <= 12)).toBe(true);
    expect(plan.fragments.join(plan.joiners[0] ?? '')).not.toContain('NIRA_ATOMIC');
  });

  it('rejects invalid limits', () => {
    expect(() => createPageFragmentPlan('text', 'text', new Map(), 0)).toThrow(RangeError);
  });
});
