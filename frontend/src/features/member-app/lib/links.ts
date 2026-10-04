/**
 * Path aplikasi member. Rute aplikasi referensi ("/classes") hidup di bawah
 * /member di sini; proxy host member menulis ulang "/classes" ke
 * "/member/classes", jadi tautan berawalan /member benar di kedua host.
 */
export function m(path: string): string {
  return path === "/" ? "/member" : `/member${path}`;
}

/** Aset publik aplikasi member (lolos proxy host member). */
export const asset = (path: string) => `/member-assets${path}`;
