"use client";

import { useEffect, useState, type ChangeEvent } from "react";

const MAX_BYTES = 2 * 1024 * 1024;
const CV_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];
const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];

/** CV and photo selection, type and size checks (2MB max) and the photo preview. */
export function useApplicationFiles() {
  const [cvFile, setCvFile] = useState<File | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  // The preview object URL is released when replaced or when the page unmounts.
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
    pick(e, { types: CV_TYPES, typeError: "CV must be a PDF or DOC file", sizeError: "CV must be 2MB or smaller" }, setCvFile);

  const onPhotoChange = (e: ChangeEvent<HTMLInputElement>) =>
    pick(e, { types: PHOTO_TYPES, typeError: "Photo must be a JPG or PNG file", sizeError: "Photo must be 2MB or smaller" }, (file) => {
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
