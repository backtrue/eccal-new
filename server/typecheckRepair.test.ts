import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getAuthenticatedEccalUser,
  mapPublicProfileUpdate,
  projectPublicAccountMember,
} from './typecheckRepairTypes';

test('authenticated ECCAL user preserves canonical member fields', () => {
  const user = getAuthenticatedEccalUser({
    id: 'member-1',
    email: 'member@example.com',
    name: 'Member',
    membershipLevel: 'pro',
    credits: 8,
  });

  assert.deepEqual(user, {
    id: 'member-1',
    email: 'member@example.com',
    name: 'Member',
    membershipLevel: 'pro',
    credits: 8,
  });
});

test('authenticated ECCAL user keeps JWT-only optional fields absent', () => {
  assert.deepEqual(getAuthenticatedEccalUser({ id: 'member-2' }), {
    id: 'member-2',
    email: undefined,
    name: undefined,
    membershipLevel: undefined,
    credits: undefined,
  });
});

test('authenticated ECCAL user rejects values without a verified member id', () => {
  assert.equal(getAuthenticatedEccalUser(undefined), null);
  assert.equal(getAuthenticatedEccalUser({ email: 'member@example.com' }), null);
  assert.equal(getAuthenticatedEccalUser({ id: 1 }), null);
});

test('authenticated canonical user may retain nullable non-identity fields', () => {
  const authenticated = getAuthenticatedEccalUser({
    id: 'member-nullables',
    email: null,
    name: null,
    membershipLevel: null,
    credits: null,
    lastLoginAt: null,
    createdAt: null,
  });

  assert.ok(authenticated);
  assert.equal(authenticated.id, 'member-nullables');
});

test('account-center projects canonical membershipLevel to public membership', () => {
  const authenticated = getAuthenticatedEccalUser({
    id: 'member-public',
    email: 'public@example.com',
    name: 'Public member',
    membershipLevel: 'pro',
    credits: 12,
  });

  assert.ok(authenticated);
  assert.deepEqual(projectPublicAccountMember(authenticated), {
    id: 'member-public',
    email: 'public@example.com',
    name: 'Public member',
    membership: 'pro',
    credits: 12,
  });
});

test('account-center maps public profilePicture only to canonical profileImageUrl', () => {
  assert.deepEqual(
    mapPublicProfileUpdate({
      name: 'Updated member',
      profilePicture: 'https://example.test/member.png',
    }),
    {
      name: 'Updated member',
      profileImageUrl: 'https://example.test/member.png',
    },
  );
});
