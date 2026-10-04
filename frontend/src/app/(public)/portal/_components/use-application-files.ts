"use client";

import { useEffect, useState, type ChangeEvent } from "react";

const MAX_BYTES = 2 * 1024 * 1024;
const CV_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];
const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];

/** Pilihan CV & pas foto + validasi tipe/ukuran (maks 2MB) + pratinjau foto. */
export function useApplicationFiles() {
  const [cvFile, setCvFile] = useState<File | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  // object URL pratinjau dilepas saat diganti atau halaman dilepas
  useEffect(() => () => {
    if (photoPreview) URL.revokeObjectURL(photoPreview);
  }, [photoPreview]);

  const pick = (
    e: ChangeEvent<HTMLInputElement>,
    rule: { types: string[]; typeError: string; sizeError: string },
    accept: (file: File) => void
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!rule.types.includes(file.type)) return setFileError(rule.typeError);
    if (file.size > MAX_BYTES) return setFileError(rule.sizeError);
    accept(file);
    setFileError(null);
  };

  const onCvChange = (e: ChangeEvent<HTMLInputElement>) =>
    pick(e, { types: CV_TYPES, typeError: "CV harus format PDF atau DOC", sizeError: "CV maksimal 2MB" }, setCvFile);

  const onPhotoChange = (e: ChangeEvent<HTMLInputElement>) =>
    pick(e, { types: PHOTO_TYPES, typeError: "Foto harus format JPG/PNG", sizeError: "Foto maksimal 2MB" }, (file) => {
      setPhotoFile(file);
      setPhotoPreview(URL.createObjectURL(file));
    });

  const removePhoto = () => {
    setPhotoFile(null);
    setPhotoPreview(null);
  };

  return {
    cvFile,
    photoFile,
    photoPreview,
    fileError,
    onCvChange,
    onPhotoChange,
    removeCv: () => setCvFile(null),
    removePhoto,
  };
}

export type ApplicationFiles = ReturnType<typeof useApplicationFiles>;
