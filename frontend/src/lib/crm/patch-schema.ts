import { z } from "zod";

/**
 * Skema PATCH dari skema objek: semua field opsional, TANPA default dan tanpa
 * refine objek. Di zod 4, `.partial()` mengisi default untuk field yang tidak
 * dikirim (toggle `is_active` ikut mereset `sort_order`, dst.) dan melempar
 * galat bila skemanya punya refine — keduanya salah untuk update parsial.
 */
export function patchSchemaOf<S extends z.ZodRawShape, K extends keyof S = never>(
  base: z.ZodObject<S>,
  omit: readonly K[] = []
): z.ZodType<Partial<Omit<z.output<z.ZodObject<S>>, K>>> {
  const shape: Record<string, z.ZodType> = {};
  for (const [key, field] of Object.entries(base.shape)) {
    if ((omit as readonly string[]).includes(key)) continue;
    const inner = field instanceof z.ZodDefault ? field.unwrap() : field;
    shape[key] = (inner as z.ZodType).optional();
  }
  // Skema `.strict()` tetap menolak key asing.
  const patch = base.def.catchall ? z.object(shape).catchall(base.def.catchall) : z.object(shape);
  return patch as unknown as z.ZodType<Partial<Omit<z.output<z.ZodObject<S>>, K>>>;
}
