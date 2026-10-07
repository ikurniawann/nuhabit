"use client";

import { useRef, useState } from "react";
import { PhotoIcon } from "@heroicons/react/24/outline";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { CategoryAutocomplete } from "./category-autocomplete";
import { useUpdateProduct, useUploadThumbnail } from "../queries";
import type { TicketProductDetail, TicketStatus } from "../types";

interface InfoVariantsTabProps {
  detail: TicketProductDetail;
}

interface VariantForm {
  id: string;
  name: string;
  price_regular: string;
  price_high: string;
}

const toPriceInput = (value: number | null) =>
  value === null ? "" : String(value);
const toPriceValue = (input: string): number | null =>
  input.trim() === "" ? null : Math.max(0, Number(input) || 0);

export function InfoVariantsTab({ detail }: InfoVariantsTabProps) {
  const { product } = detail;
  const [name, setName] = useState(product.name);
  const [categoryName, setCategoryName] = useState(product.category_name ?? "");
  const [status, setStatus] = useState<TicketStatus>(product.status);
  const [basePrice, setBasePrice] = useState(String(product.base_price));
  const [description, setDescription] = useState(product.description ?? "");
  const [variants, setVariants] = useState<VariantForm[]>(
    detail.variants.map((v) => ({
      id: v.id,
      name: v.name,
      price_regular: toPriceInput(v.price_regular),
      price_high: toPriceInput(v.price_high),
    }))
  );
  const fileInputRef = useRef<HTMLInputElement>(null);

  const updateMutation = useUpdateProduct();
  const uploadMutation = useUploadThumbnail();

  const setVariant = (index: number, patch: Partial<VariantForm>) => {
    setVariants((prev) =>
      prev.map((v, i) => (i === index ? { ...v, ...patch } : v))
    );
  };

  const priceComplete = variants.every(
    (v) => v.price_regular.trim() !== "" && v.price_high.trim() !== ""
  );

  const handleSave = () => {
    if (updateMutation.isPending) return;
    updateMutation.mutate({
      id: product.id,
      values: {
        name: name.trim(),
        category_name: categoryName.trim() || null,
        status,
        base_price: Number(basePrice) || 0,
        description: description.trim() || null,
        variants: variants.map((v) => ({
          id: v.id,
          name: v.name.trim(),
          price_regular: toPriceValue(v.price_regular),
          price_high: toPriceValue(v.price_high),
        })),
      },
    });
  };

  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="edit_name">Nama Ticket *</Label>
            <Input
              id="edit_name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Kategori</Label>
            <CategoryAutocomplete value={categoryName} onChange={setCategoryName} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select
                value={status}
                onValueChange={(v) => setStatus(v as TicketStatus)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">Draft — belum dijual</SelectItem>
                  <SelectItem value="active">Active — siap dijual</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit_base_price">Base Price (Rp)</Label>
              <Input
                id="edit_base_price"
                type="number"
                min={0}
                step={5000}
                value={basePrice}
                onChange={(e) => setBasePrice(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit_description">Description</Label>
            <Textarea
              id="edit_description"
              rows={4}
              placeholder="Deskripsi ticket (tampil di website booking nanti)"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </div>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Thumbnail</Label>
            <div className="flex items-center gap-4">
              {product.thumbnail_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={product.thumbnail_url}
                  alt="Thumbnail ticket"
                  className="h-24 w-24 rounded-xl object-cover"
                />
              ) : (
                <div className="flex h-24 w-24 items-center justify-center rounded-xl border border-dashed border-gray-300 bg-gray-50">
                  <PhotoIcon className="h-8 w-8 text-gray-300" />
                </div>
              )}
              <div className="space-y-1">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={uploadMutation.isPending}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {uploadMutation.isPending ? "Mengunggah…" : "Unggah Gambar"}
                </Button>
                <p className="text-xs text-gray-500">JPG/PNG/WEBP, maks 3 MB</p>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) uploadMutation.mutate({ id: product.id, file });
                  e.target.value = "";
                }}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Harga per Varian</Label>
            <div className="overflow-hidden rounded-lg border border-gray-200/70">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200/70 bg-gray-50/80 text-xs uppercase tracking-wide text-gray-500">
                    <th className="px-3 py-2 text-left font-semibold">Varian</th>
                    <th className="px-3 py-2 text-left font-semibold">
                      Harga Regular (Rp)
                    </th>
                    <th className="px-3 py-2 text-left font-semibold">
                      Harga High Season (Rp)
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200/50">
                  {variants.map((variant, index) => (
                    <tr key={variant.id}>
                      <td className="px-3 py-2 font-medium text-gray-900">
                        {variant.name}
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          type="number"
                          min={0}
                          step={5000}
                          placeholder="belum diisi"
                          value={variant.price_regular}
                          onChange={(e) =>
                            setVariant(index, { price_regular: e.target.value })
                          }
                          className="h-9"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          type="number"
                          min={0}
                          step={5000}
                          placeholder="belum diisi"
                          value={variant.price_high}
                          onChange={(e) =>
                            setVariant(index, { price_high: e.target.value })
                          }
                          className="h-9"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!priceComplete ? (
              <p className="text-xs text-amber-600">
                Harga belum lengkap — gate akan menolak charge sampai Regular &
                High Season terisi (0 = gratis/comp sah).
              </p>
            ) : null}
          </div>
        </div>
      </div>

      <div className="flex justify-end border-t border-gray-200/70 pt-4">
        <Button
          onClick={handleSave}
          disabled={!name.trim() || updateMutation.isPending}
        >
          {updateMutation.isPending ? "Menyimpan…" : "Simpan Perubahan"}
        </Button>
      </div>
    </div>
  );
}
