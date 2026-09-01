export function archiveError(message, { statusCode = 500, code } = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

export const ARCHIVE_ERROR_CODES = Object.freeze({
  ARCHIVE_VERSION_NOT_FOUND: "ARCHIVE_VERSION_NOT_FOUND",
  ARCHIVE_BRANCH_NOT_FOUND: "ARCHIVE_BRANCH_NOT_FOUND",
  STALE_ARCHIVE_MAP: "STALE_ARCHIVE_MAP",
  MAP_RELEASE_MISMATCH: "MAP_RELEASE_MISMATCH",
});
