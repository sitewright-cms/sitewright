import { describe, it, expect } from 'vitest';
import { parseVisualAudit, tallyDefects, buildAuditPrompt, type VisualDefect, type AuditViewport } from '../src/render/visual-audit.js';

const shot = (base64: string) => ({ base64, mimeType: 'image/jpeg' as const, width: 1280, height: 3000 });

describe('parseVisualAudit', () => {
  it('parses a clean JSON object', () => {
    const { defects, summary } = parseVisualAudit(
      '{"summary":"close but hero image missing","defects":[{"region":"hero","category":"image","severity":"major","description":"no photo"}]}',
    );
    expect(summary).toBe('close but hero image missing');
    expect(defects).toEqual([{ region: 'hero', category: 'image', severity: 'major', description: 'no photo' }]);
  });

  it('tolerates ```json fences + surrounding prose', () => {
    const text = 'Here is my audit:\n```json\n{"summary":"ok","defects":[]}\n```\nThanks!';
    const { defects, summary } = parseVisualAudit(text);
    expect(summary).toBe('ok');
    expect(defects).toEqual([]);
  });

  it('extracts a bare {…} object embedded in prose', () => {
    const { defects } = parseVisualAudit('The result is {"defects":[{"region":"footer","category":"content","severity":"minor","description":"missing credit line"}]} done');
    expect(defects).toHaveLength(1);
    expect(defects[0]!.region).toBe('footer');
  });

  it('normalizes an unknown category/severity to safe defaults + drops empty-description entries', () => {
    const { defects } = parseVisualAudit(
      '{"defects":[{"region":"x","category":"bogus","severity":"nope","description":"real"},{"region":"y","description":""}]}',
    );
    expect(defects).toEqual([{ region: 'x', category: 'content', severity: 'major', description: 'real' }]);
  });

  it('fails LOUD (a blocker) on unparseable output — never silently green', () => {
    const { defects } = parseVisualAudit('the site looks basically fine to me, no JSON here');
    expect(defects).toHaveLength(1);
    expect(defects[0]!.severity).toBe('blocker');
  });

  it('caps the defect list', () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ region: `r${i}`, category: 'layout', severity: 'minor', description: `d${i}` }));
    const { defects } = parseVisualAudit(JSON.stringify({ defects: many }));
    expect(defects.length).toBe(40);
  });
});

describe('tallyDefects — blocker+major gate, minors advisory', () => {
  const d = (severity: VisualDefect['severity']): VisualDefect => ({ region: 'r', category: 'layout', severity, description: 'x' });
  it('passes with only minors', () => {
    expect(tallyDefects([d('minor'), d('minor')])).toEqual({ blockers: 0, majors: 0, minors: 2, pass: true });
  });
  it('fails on any major or blocker', () => {
    expect(tallyDefects([d('major')]).pass).toBe(false);
    expect(tallyDefects([d('blocker')]).pass).toBe(false);
  });
  it('passes an empty defect list', () => {
    expect(tallyDefects([])).toEqual({ blockers: 0, majors: 0, minors: 0, pass: true });
  });
});

describe('buildAuditPrompt', () => {
  it('emits ORIGINAL-then-CLONE attachments per complete viewport, with a legend', () => {
    const vps: AuditViewport[] = [
      { name: 'desktop', original: shot('od'), clone: shot('cd') },
      { name: 'mobile', original: shot('om'), clone: shot('cm') },
    ];
    const { attachments, legend } = buildAuditPrompt(vps);
    expect(attachments.map((a) => a.data)).toEqual(['od', 'cd', 'om', 'cm']);
    expect(attachments.every((a) => a.kind === 'image')).toBe(true);
    expect(legend).toContain('Image 1 = ORIGINAL (desktop)');
    expect(legend).toContain('Image 2 = CLONE (desktop)');
    expect(legend).toContain('Image 4 = CLONE (mobile)');
  });

  it('skips a viewport missing one side (no one-sided comparison)', () => {
    const { attachments } = buildAuditPrompt([{ name: 'desktop', original: shot('od') }]);
    expect(attachments).toHaveLength(0);
  });
});
