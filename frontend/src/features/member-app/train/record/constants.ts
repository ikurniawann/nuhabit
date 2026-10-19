import {
  Bike,
  Dumbbell,
  Flame,
  Footprints,
  PersonStanding,
} from "lucide-react";
import type { Division } from "@/lib/gym/hyrox";
import type { ActivityType } from "../../lib/queries-train";

export const DIVISIONS: { id: Division; label: string }[] = [
  { id: "MEN_OPEN", label: "Men Open" },
  { id: "WOMEN_OPEN", label: "Women Open" },
  { id: "MEN_PRO", label: "Men Pro" },
  { id: "WOMEN_PRO", label: "Women Pro" },
];

export const TYPE_TILES: {
  id: ActivityType | "HYROX";
  label: string;
  hint: string;
  icon: typeof Footprints;
}[] = [
  { id: "RUN", label: "Run", hint: "GPS tracked", icon: Footprints },
  { id: "RIDE", label: "Ride", hint: "GPS tracked", icon: Bike },
  { id: "WALK", label: "Walk", hint: "GPS tracked", icon: PersonStanding },
  { id: "WORKOUT", label: "Workout", hint: "Sets & reps", icon: Dumbbell },
  { id: "HYROX", label: "HYROX Sim", hint: "Guided race", icon: Flame },
];
