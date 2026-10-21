/** Kelas tombol chip filter: lime-forest saat aktif, krem saat tidak. */
export const chipClass = (active: boolean) =>
  `shrink-0 whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-bold transition ${
    active ? "bg-nh-forest/10 text-nh-forest ring-1 ring-nh-forest/20" : "bg-nh-cream text-nh-muted"
  }`;
