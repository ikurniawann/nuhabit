"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchActiveBrands } from "../candidates/api";
import { jobPortalQueryKeys } from "./query-keys";
import { fetchJobOpenings, fetchJobPositions, fetchJobDepartments } from "./api";

export const useJobOpenings = () =>
  useQuery({ queryKey: jobPortalQueryKeys.jobs(), queryFn: fetchJobOpenings });

export const useJobBrands = () =>
  useQuery({ queryKey: jobPortalQueryKeys.brands(), queryFn: fetchActiveBrands });

export const useJobPositions = () =>
  useQuery({ queryKey: jobPortalQueryKeys.positions(), queryFn: fetchJobPositions });

export const useJobDepartments = () =>
  useQuery({ queryKey: jobPortalQueryKeys.departments(), queryFn: fetchJobDepartments });
