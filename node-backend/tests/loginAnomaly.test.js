import { evaluateLoginGeo } from '../src/services/loginAnomaly.js';

// Pure-logic tests for the unfamiliar-login-location decision — see the
// comment on evaluateLoginGeo for why this is city/country-based rather
// than raw-IP-based, and why the very first login never alerts.
describe('evaluateLoginGeo', () => {
  it('does not flag when the geo lookup failed or is null', () => {
    const result = evaluateLoginGeo(['Cape Town, South Africa'], null);
    expect(result.isUnfamiliar).toBe(false);
    expect(result.updatedKnownGeos).toEqual(['Cape Town, South Africa']);
  });

  it('never flags an internal/private-network login', () => {
    const result = evaluateLoginGeo(['Cape Town, South Africa'], 'Local / Private');
    expect(result.isUnfamiliar).toBe(false);
  });

  it('does not flag the very first login ever — it just establishes the baseline', () => {
    const result = evaluateLoginGeo([], 'Cape Town, South Africa');
    expect(result.isUnfamiliar).toBe(false);
    expect(result.updatedKnownGeos).toEqual(['Cape Town, South Africa']);
  });

  it('does not flag a login from an already-known city', () => {
    const result = evaluateLoginGeo(['Cape Town, South Africa', 'Johannesburg, South Africa'], 'Cape Town, South Africa');
    expect(result.isUnfamiliar).toBe(false);
    expect(result.updatedKnownGeos).toEqual(['Cape Town, South Africa', 'Johannesburg, South Africa']);
  });

  it('flags a genuinely new city once a baseline already exists', () => {
    const result = evaluateLoginGeo(['Cape Town, South Africa'], 'Moscow, Russia');
    expect(result.isUnfamiliar).toBe(true);
    expect(result.updatedKnownGeos).toEqual(['Moscow, Russia', 'Cape Town, South Africa']);
  });

  it('caps the known-geo history so it cannot grow unbounded', () => {
    const known = Array.from({ length: 20 }, (_, i) => `City ${i}, Country`);
    const result = evaluateLoginGeo(known, 'New City, New Country');
    expect(result.updatedKnownGeos).toHaveLength(20);
    expect(result.updatedKnownGeos[0]).toBe('New City, New Country');
    expect(result.updatedKnownGeos).not.toContain('City 19, Country');
  });
});
