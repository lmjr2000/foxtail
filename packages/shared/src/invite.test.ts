import { describe, expect, it } from 'vitest';
import { inviteTokenFromPath, isInvitePath } from './invite.js';

describe('prospect link paths', () => {
  it('extracts a token', () => {
    expect(inviteTokenFromPath('/d/AbCdEfGhIjKlMnOpQrStUvWxYz012345')).toBe('AbCdEfGhIjKlMnOpQrStUvWxYz012345');
    expect(inviteTokenFromPath('/d/abc_def-ghi_jklmno/')).toBe('abc_def-ghi_jklmno');
  });
  it('rejects malformed tokens but still recognises the path', () => {
    for (const p of ['/d/short', '/d/has space in it xxxxx', '/d/', '/d', '/stores/x', '/d/a/b']) expect(inviteTokenFromPath(p)).toBeNull();
    expect(isInvitePath('/d/short')).toBe(true);
    expect(isInvitePath('/d')).toBe(true);
    expect(isInvitePath('/dashboard')).toBe(false);
  });
});
