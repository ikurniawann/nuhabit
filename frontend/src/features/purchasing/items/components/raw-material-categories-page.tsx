import { ItemsLookupPage } from "@/features/purchasing/items/components/items-lookup-page";

export function RawMaterialCategoriesPage() {
  return (
    <ItemsLookupPage
      lookupType="raw-material-categories"
      listTitle="Daftar Kategori"
      listDescription="Tinjau kode, nama, deskripsi, dan status aktif kategori."
      addButtonLabel="Tambah Kategori"
    />
  );
}
