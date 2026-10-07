import { describe, expect, it } from 'vitest';
import { buildMerchandiseColumns } from './merchandise-fields';

describe('merchandise size guide', () => {
  it('stores supplied measurements and clears an empty guide', () => {
    expect(buildMerchandiseColumns({ size_guide: '  M — chest 100 cm  ' })).toEqual({
      ok: true,
      columns: { size_guide: 'M — chest 100 cm' },
    });
    expect(buildMerchandiseColumns({ size_guide: ' ' })).toEqual({
      ok: true,
      columns: { size_guide: null },
    });
  });
});
