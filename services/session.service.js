function getTokenVersion(user) {
  return user.tokenVersion ?? 0;
}

function tokenVersionFilter(user) {
  const tokenVersion = getTokenVersion(user);
  // Accounts and tokens issued before session versioning remain valid until a password change.
  return tokenVersion === 0
    ? { $or: [{ tokenVersion: 0 }, { tokenVersion: null }] }
    : { tokenVersion };
}

module.exports = { getTokenVersion, tokenVersionFilter };
