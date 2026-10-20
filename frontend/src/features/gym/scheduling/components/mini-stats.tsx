/** Tiga angka ringkas berjajar, muat di layar ponsel. */
export function MiniStats({ items }: { items: { label: string; value: string }[] }) {
  return (
    <dl className="grid grid-cols-3 gap-2 rounded-2xl bg-surface p-3 text-center">
      {items.map((item) => (
        <div key={item.label}>
          <dt className="text-[11px] text-muted-foreground">{item.label}</dt>
          <dd className="text-lg font-semibold tabular-nums">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
