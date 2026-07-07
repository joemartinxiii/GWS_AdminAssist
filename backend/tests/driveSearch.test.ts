import { buildQuery } from '../src/services/driveSearch.service';

// The `q` builder is the security-sensitive core of org-wide search: it must
// escape user-supplied strings so they can't break out of the Drive query
// literal, and it must translate structured criteria into valid clauses.
describe('driveSearch buildQuery', () => {
  it('defaults to non-trashed and combines name + full-text for free text', () => {
    const q = buildQuery({ text: 'budget' });
    expect(q).toContain('trashed = false');
    expect(q).toContain("name contains 'budget'");
    expect(q).toContain("fullText contains 'budget'");
    expect(q).toMatch(/\(name contains 'budget' or fullText contains 'budget'\)/);
  });

  it('escapes single quotes to prevent query injection', () => {
    const q = buildQuery({ text: "O'Brien' or trashed = true or '" });
    // The raw closing quote must be escaped so it can't terminate the literal.
    expect(q).toContain("\\'");
    expect(q).not.toMatch(/contains 'O'Brien'/);
  });

  it('omits the trashed clause when includeTrashed is set', () => {
    const q = buildQuery({ text: 'x', includeTrashed: true });
    expect(q).not.toContain('trashed = false');
  });

  it('adds mimeType and date clauses as RFC3339', () => {
    const q = buildQuery({
      mimeType: 'application/pdf',
      modifiedAfter: '2024-01-01',
      createdBefore: '2024-12-31',
    });
    expect(q).toContain("mimeType = 'application/pdf'");
    expect(q).toContain("modifiedTime >= '2024-01-01T00:00:00.000Z'");
    expect(q).toContain("createdTime <= '2024-12-31T00:00:00.000Z'");
  });

  it('drops invalid dates rather than emitting a broken clause', () => {
    const q = buildQuery({ text: 'x', modifiedAfter: 'not-a-date' });
    expect(q).not.toContain('modifiedTime');
  });

  it('returns an empty string when no criteria and trashed included', () => {
    expect(buildQuery({ includeTrashed: true })).toBe('');
  });
});
