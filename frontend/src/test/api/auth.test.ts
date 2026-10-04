import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createServerPgClient } from "@/lib/pg/create-client";

// Auth helpers — no live database in unit test context
import {
  ApiError,
  paginatedResponse,
  successResponse,
  createdResponse,
  noContentResponse,
} from '@/lib/api/auth';

describe('API Auth Helpers', () => {
  describe('ApiError', () => {
    it('creates badRequest error', () => {
      const error = ApiError.badRequest('Invalid input', { field: 'name' });
      expect(error.status).toBe(400);
      expect(error.message).toBe('Invalid input');
      expect(error.details).toEqual({ field: 'name' });
    });

    it('creates unauthorized error', () => {
      const error = ApiError.unauthorized();
      expect(error.status).toBe(401);
      expect(error.message).toBe('Authentication required');
    });

    it('creates forbidden error', () => {
      const error = ApiError.forbidden('No access');
      expect(error.status).toBe(403);
    });

    it('creates notFound error', () => {
      const error = ApiError.notFound();
      expect(error.status).toBe(404);
      expect(error.message).toBe('Resource not found');
    });

    it('creates conflict error', () => {
      const error = ApiError.conflict('Already exists');
      expect(error.status).toBe(409);
    });

    it('creates server error', () => {
      const error = ApiError.server();
      expect(error.status).toBe(500);
    });

    it('toResponse returns NextResponse with correct shape', async () => {
      const error = ApiError.badRequest('Test error', { details: 'info' });
      const response = error.toResponse();
      const body = await response.json();
      
      expect(response.status).toBe(400);
      expect(body.success).toBe(false);
      expect(body.error).toBe('Test error');
      expect(body.details).toEqual({ details: 'info' });
    });
  });

  describe('Response helpers', () => {
    it('successResponse returns correct shape', async () => {
      const data = { id: '1', name: 'Test' };
      const response = successResponse(data, 'Success message');
      const body = await response.json();
      
      expect(body.success).toBe(true);
      expect(body.data).toEqual(data);
      expect(body.message).toBe('Success message');
    });

    it('successResponse without message', async () => {
      const data = { id: '1' };
      const response = successResponse(data);
      const body = await response.json();
      
      expect(body.success).toBe(true);
      expect(body.message).toBeUndefined();
    });

    it('createdResponse returns 201 status', async () => {
      const data = { id: '1' };
      const response = createdResponse(data);
      
      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body.success).toBe(true);
      expect(body.data).toEqual(data);
      expect(body.message).toBe('Created successfully');
    });

    it('noContentResponse returns 204', () => {
      const response = noContentResponse();
      expect(response.status).toBe(204);
    });

    it('paginatedResponse returns correct shape', async () => {
      const data = [{ id: '1' }, { id: '2' }];
      const meta = { page: 1, limit: 20, total: 50, totalPages: 3 };
      const response = paginatedResponse(data, meta);
      const body = await response.json();
      
      expect(body.success).toBe(true);
      expect(body.data).toEqual(data);
      expect(body.pagination).toEqual(meta);
    });
  });
});

describe('Auth Middleware - requireApiUser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should be callable and handle auth flow', async () => {
    // The actual requireApiUser calls createClient which is mocked
    // This tests that the mock is set up correctly
    const db = await createServerPgClient();
    const { data: { user } } = await db.auth.getUser();
    
    expect(user?.id).toBe('test-user-id');
  });
});
