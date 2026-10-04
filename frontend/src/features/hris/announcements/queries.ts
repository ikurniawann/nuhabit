"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchAnnouncements, fetchDepartments } from "./api";
import { announcementQueryKeys } from "./query-keys";

export const useAnnouncements = () =>
  useQuery({ queryKey: announcementQueryKeys.list(), queryFn: fetchAnnouncements });

export const useAnnouncementDepartments = () =>
  useQuery({ queryKey: announcementQueryKeys.departments(), queryFn: fetchDepartments });
