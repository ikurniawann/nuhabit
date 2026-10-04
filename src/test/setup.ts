import { vi } from 'vitest';
// Matcher jest-dom (toBeInTheDocument, dst.) beserta tipe untuk expect vitest.
import '@testing-library/jest-dom/vitest';

// Mock Next.js headers
vi.mock('next/headers', () => ({
  cookies: vi.fn(() => ({
    get: vi.fn(),
    set: vi.fn(),
  })),
  headers: vi.fn(() => ({
    get: vi.fn(),
  })),
}));

// Mock Postgres server client
vi.mock('@/lib/pg/create-client', () => ({
  createServerPgClient: vi.fn(async () => ({
    auth: {
      getUser: vi.fn(() => ({
        data: {
          user: {
            id: 'test-user-id',
            email: 'test@example.com',
          },
        },
      })),
    },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(() => ({ data: null, error: null })),
          ilike: vi.fn(() => ({
            order: vi.fn(() => ({
              range: vi.fn(() => ({ data: [], count: 0, error: null })),
              limit: vi.fn(() => ({ data: [], error: null })),
            })),
          })),
          or: vi.fn(() => ({
            order: vi.fn(() => ({
              range: vi.fn(() => ({ data: [], count: 0, error: null })),
            })),
          })),
          order: vi.fn(() => ({
            range: vi.fn(() => ({ data: [], count: 0, error: null })),
            limit: vi.fn(() => ({ data: [], error: null })),
          })),
          range: vi.fn(() => ({ data: [], count: 0, error: null })),
        })),
        insert: vi.fn(() => ({
          select: vi.fn(() => ({
            single: vi.fn(() => ({ data: null, error: null })),
          })),
        })),
        update: vi.fn(() => ({
          eq: vi.fn(() => ({
            select: vi.fn(() => ({
              single: vi.fn(() => ({ data: null, error: null })),
            })),
          })),
        })),
        delete: vi.fn(() => ({
          eq: vi.fn(() => ({ error: null })),
        })),
      })),
    })),
  })),
}));

// jsdom under Node 26 does not provide Web Storage; install an in-memory polyfill.
function createStorageMock(): Storage {
  let store: Record<string, string> = {};
  return {
    get length() {
      return Object.keys(store).length;
    },
    clear() {
      store = {};
    },
    getItem(key: string) {
      return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null;
    },
    key(index: number) {
      return Object.keys(store)[index] ?? null;
    },
    removeItem(key: string) {
      delete store[key];
    },
    setItem(key: string, value: string) {
      store[key] = String(value);
    },
  } as Storage;
}

if (typeof window !== "undefined" && !window.localStorage) {
  Object.defineProperty(window, "localStorage", {
    value: createStorageMock(),
    writable: true,
    configurable: true,
  });
}
if (typeof window !== "undefined" && !window.sessionStorage) {
  Object.defineProperty(window, "sessionStorage", {
    value: createStorageMock(),
    writable: true,
    configurable: true,
  });
}
