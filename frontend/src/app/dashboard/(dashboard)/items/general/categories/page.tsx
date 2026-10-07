import { ItemsLookupPage } from "@/features/purchasing/items/components/items-lookup-page";

export default function Page() {
  return (
    <ItemsLookupPage
      lookupType="supply-categories"
      breadcrumbs={[
        { label: "Barang Operasional", href: "/dashboard/items/general/items" },
        { label: "Kategori" },
      ]}
      listTitle="Kategori Barang Operasional"
      listDescription="Kelola kategori ATK, spare part & consumable"
      addButtonLabel="Tambah Kategori"
    />
  );
}
