/**
 * Standard CRUD URL helpers for dashboard modules.
 * Create: {base}/insert
 * Edit:   {base}/edit/{id}
 */

export function crudInsertPath(basePath: string): string {
  return `${basePath.replace(/\/$/, "")}/insert`;
}

export function crudEditPath(basePath: string, id: string): string {
  return `${basePath.replace(/\/$/, "")}/edit/${id}`;
}

export function crudDetailPath(basePath: string, id: string): string {
  return `${basePath.replace(/\/$/, "")}/${id}`;
}
