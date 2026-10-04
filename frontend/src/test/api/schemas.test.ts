import { describe, it, expect } from 'vitest';
import { z } from 'zod';

// Test Zod schemas used in route handlers
describe('Supplier API Schemas', () => {
  const createSupplierSchema = z.object({
    nama: z.string().min(1, "Nama supplier wajib diisi"),
    alamat: z.string().optional(),
    telepon: z.string().optional(),
    email: z.string().email("Email tidak valid").optional().or(z.literal("")),
    npwp: z.string().optional(),
    bank_nama: z.string().optional(),
    bank_rekening: z.string().optional(),
    bank_atas_nama: z.string().optional(),
    kategori: z.string().optional(),
    status: z.enum(["active", "inactive", "blacklisted"]).default("active"),
  });

  const updateSupplierSchema = createSupplierSchema.partial();

  const queryParamsSchema = z.object({
    page: z.coerce.number().min(1).default(1),
    limit: z.coerce.number().min(1).max(100).default(20),
    search: z.string().optional(),
    status: z.enum(["active", "inactive", "blacklisted"]).optional(),
    kategori: z.string().optional(),
  });

  describe('createSupplierSchema', () => {
    it('validates correct supplier data', () => {
      const valid = {
        nama: 'PT Maju Jaya',
        alamat: 'Jl. Sudirman No. 1',
        telepon: '021-123456',
        email: 'info@majujaya.com',
        npwp: '01.234.567.8-901.000',
        kategori: 'raw_material',
        status: 'active',
      };

      const result = createSupplierSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    it('rejects empty nama', () => {
      const invalid = { nama: '' };
      const result = createSupplierSchema.safeParse(invalid);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toBe('Nama supplier wajib diisi');
      }
    });

    it('rejects invalid email', () => {
      const invalid = { nama: 'Test', email: 'not-an-email' };
      const result = createSupplierSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('accepts empty email', () => {
      const valid = { nama: 'Test', email: '' };
      const result = createSupplierSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    it('rejects invalid status', () => {
      const invalid = { nama: 'Test', status: 'pending' };
      const result = createSupplierSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('defaults status to active', () => {
      const minimal = { nama: 'Test' };
      const result = createSupplierSchema.parse(minimal);
      expect(result.status).toBe('active');
    });
  });

  describe('updateSupplierSchema', () => {
    it('allows partial updates', () => {
      const partial = { nama: 'Updated Name' };
      const result = updateSupplierSchema.safeParse(partial);
      expect(result.success).toBe(true);
    });

    it('allows empty object', () => {
      const result = updateSupplierSchema.safeParse({});
      expect(result.success).toBe(true);
    });
  });

  describe('queryParamsSchema', () => {
    it('applies defaults', () => {
      const result = queryParamsSchema.parse({});
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
    });

    it('coerces string numbers', () => {
      const result = queryParamsSchema.parse({ page: '2', limit: '50' });
      expect(result.page).toBe(2);
      expect(result.limit).toBe(50);
    });

    it('rejects page < 1', () => {
      const result = queryParamsSchema.safeParse({ page: '0' });
      expect(result.success).toBe(false);
    });

    it('rejects limit > 100', () => {
      const result = queryParamsSchema.safeParse({ limit: '200' });
      expect(result.success).toBe(false);
    });

    it('accepts valid filters', () => {
      const result = queryParamsSchema.parse({
        search: 'tokopedia',
        status: 'active',
        kategori: 'it',
      });
      expect(result.search).toBe('tokopedia');
      expect(result.status).toBe('active');
    });
  });
});

describe('Satuan API Schemas', () => {
  const createSatuanSchema = z.object({
    kode: z.string().min(1, "Kode satuan wajib diisi").max(20),
    nama: z.string().min(1, "Nama satuan wajib diisi").max(100),
    deskripsi: z.string().optional(),
  });

  it('validates correct satuan', () => {
    const valid = { kode: 'KG', nama: 'Kilogram' };
    const result = createSatuanSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it('rejects kode > 20 chars', () => {
    const invalid = { kode: 'A'.repeat(21), nama: 'Test' };
    const result = createSatuanSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('rejects empty nama', () => {
    const invalid = { kode: 'KG', nama: '' };
    const result = createSatuanSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });
});

describe('Material API Schemas', () => {
  const createMaterialSchema = z.object({
    kode: z.string().min(1).max(50),
    nama: z.string().min(1).max(200),
    deskripsi: z.string().optional(),
    satuan_id: z.string().uuid("Satuan ID tidak valid"),
    kategori: z.string().optional(),
    harga_estimasi: z.number().positive().optional(),
    minimum_stock: z.number().min(0).default(0),
    maximum_stock: z.number().positive().optional(),
    current_stock: z.number().min(0).default(0),
    lokasi_rak: z.string().optional(),
    lead_time_days: z.number().min(0).default(0).refine(v => Number.isInteger(v), {
      message: "Lead time must be an integer"
    }),
  });

  it('validates correct material', () => {
    const valid = {
      kode: 'BB-001',
      nama: 'Besi Beton',
      satuan_id: '550e8400-e29b-41d4-a716-446655440000',
      minimum_stock: 100,
    };
    const result = createMaterialSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it('rejects invalid UUID', () => {
    const invalid = {
      kode: 'BB-001',
      nama: 'Test',
      satuan_id: 'not-a-uuid',
    };
    const result = createMaterialSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('defaults numeric fields', () => {
    const minimal = {
      kode: 'BB-001',
      nama: 'Test',
      satuan_id: '550e8400-e29b-41d4-a716-446655440000',
    };
    const result = createMaterialSchema.parse(minimal);
    expect(result.minimum_stock).toBe(0);
    expect(result.current_stock).toBe(0);
    expect(result.lead_time_days).toBe(0);
  });
});

describe('Product API Schemas', () => {
  const createProductSchema = z.object({
    kode: z.string().min(1).max(50),
    nama: z.string().min(1).max(200),
    deskripsi: z.string().optional(),
    satuan_id: z.string().uuid(),
    kategori: z.string().optional(),
    harga_jual: z.number().positive().optional(),
  });

  const bomItemSchema = z.object({
    bahan_baku_id: z.string().uuid(),
    jumlah: z.number().positive(),
    satuan_id: z.string().uuid(),
    waste_percentage: z.number().min(0).max(100).default(0),
    urutan: z.number().min(0).default(0).refine(v => Number.isInteger(v)),
    catatan: z.string().optional(),
  });

  it('validates product with BOM', () => {
    const valid = {
      kode: 'PRD-001',
      nama: 'Besi Beton 10mm',
      satuan_id: '550e8400-e29b-41d4-a716-446655440000',
      harga_jual: 50000,
      bom: [
        {
          bahan_baku_id: '550e8400-e29b-41d4-a716-446655440001',
          jumlah: 2.5,
          satuan_id: '550e8400-e29b-41d4-a716-446655440002',
          waste_percentage: 5,
        },
      ],
    };
    const result = createProductSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it('validates BOM item', () => {
    const valid = {
      bahan_baku_id: '550e8400-e29b-41d4-a716-446655440001',
      jumlah: 1.5,
      satuan_id: '550e8400-e29b-41d4-a716-446655440002',
    };
    const result = bomItemSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it('rejects waste_percentage > 100', () => {
    const invalid = {
      bahan_baku_id: '550e8400-e29b-41d4-a716-446655440001',
      jumlah: 1,
      satuan_id: '550e8400-e29b-41d4-a716-446655440002',
      waste_percentage: 150,
    };
    const result = bomItemSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('rejects negative jumlah', () => {
    const invalid = {
      bahan_baku_id: '550e8400-e29b-41d4-a716-446655440001',
      jumlah: -1,
      satuan_id: '550e8400-e29b-41d4-a716-446655440002',
    };
    const result = bomItemSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });
});

describe('Supplier Price API Schemas', () => {
  const createPriceSchema = z.object({
    supplier_id: z.string().uuid(),
    bahan_baku_id: z.string().uuid(),
    harga: z.number().positive("Harga harus lebih dari 0"),
    satuan_id: z.string().uuid(),
    minimum_qty: z.number().positive().default(1),
    lead_time_days: z.number().min(0).default(0).refine(v => Number.isInteger(v), {
      message: "Lead time must be an integer"
    }),
    is_preferred: z.boolean().default(false),
    berlaku_dari: z.string().optional(),
    berlaku_sampai: z.string().optional(),
    catatan: z.string().optional(),
  });

  const queryParamsSchema = z.object({
    page: z.coerce.number().min(1).default(1),
    limit: z.coerce.number().min(1).max(100).default(20),
    supplier_id: z.string().uuid().optional(),
    bahan_baku_id: z.string().uuid().optional(),
    is_preferred: z.enum(["true", "false"]).transform(v => v === "true").optional(),
  });

  it('validates correct price entry', () => {
    const valid = {
      supplier_id: '550e8400-e29b-41d4-a716-446655440000',
      bahan_baku_id: '550e8400-e29b-41d4-a716-446655440001',
      harga: 15000,
      satuan_id: '550e8400-e29b-41d4-a716-446655440002',
    };
    const result = createPriceSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it('rejects harga = 0', () => {
    const invalid = {
      supplier_id: '550e8400-e29b-41d4-a716-446655440000',
      bahan_baku_id: '550e8400-e29b-41d4-a716-446655440001',
      harga: 0,
      satuan_id: '550e8400-e29b-41d4-a716-446655440002',
    };
    const result = createPriceSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('transforms is_preferred string to boolean', () => {
    const result = queryParamsSchema.parse({ is_preferred: 'true' });
    expect(result.is_preferred).toBe(true);
    
    const result2 = queryParamsSchema.parse({ is_preferred: 'false' });
    expect(result2.is_preferred).toBe(false);
  });
});
