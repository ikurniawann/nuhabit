import { asset } from './links';

/**
 * Class-type photos (reference apps/member/src/lib/images.ts). The reference
 * keys them by seed id (cls_fund, ...); class types here have uuid ids, so the
 * reference key is recovered from the class type name.
 */
const CLASS_IMAGES: Record<string, string> = {
  cls_fund: '/img/class-fund.jpg',
  cls_sim: '/img/class-sim.jpg',
  cls_str: '/img/class-str.jpg',
  cls_eng: '/img/class-eng.jpg',
  cls_mob: '/img/class-mob.jpg',
  cls_wod: '/img/class-wod.jpg',
  cls_test: '/img/class-test.jpg',
};

const NAME_KEYS: [RegExp, string][] = [
  [/fundamental/i, 'cls_fund'],
  [/simulation|\bsim\b/i, 'cls_sim'],
  [/strength/i, 'cls_str'],
  [/engine/i, 'cls_eng'],
  [/mobility|recovery/i, 'cls_mob'],
  [/\bwod\b/i, 'cls_wod'],
  [/test|benchmark/i, 'cls_test'],
];

/** Reference class-type key (cls_fund, cls_sim, ...) for a class type name, or null. */
export function classTypeKey(name: string): string | null {
  return NAME_KEYS.find(([pattern]) => pattern.test(name))?.[1] ?? null;
}

/** Photo for a class type, by its name. */
export function classImage(classTypeName: string): string | null {
  const key = classTypeKey(classTypeName);
  return key ? asset(CLASS_IMAGES[key]!) : null;
}
