const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

function parsePositiveInt(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  const integer = Math.trunc(parsed);
  return integer > 0 ? integer : null;
}

export function parsePagination(query: { page?: unknown; limit?: unknown }): { page: number; limit: number; offset: number } {
  const page = parsePositiveInt(query.page) ?? DEFAULT_PAGE;
  const requestedLimit = parsePositiveInt(query.limit) ?? DEFAULT_PAGE_SIZE;
  const limit = Math.min(requestedLimit, MAX_PAGE_SIZE);

  return {
    page,
    limit,
    offset: (page - 1) * limit,
  };
}