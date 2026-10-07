export interface ListParams {
  search?: string;
  status?: string;
  entityId?: string;
  menuType?: string;
  page?: number;
  limit?: number;
}

export interface ListResponse<T> {
  data: T[];
  total: number;
  page?: number;
  limit?: number;
}
