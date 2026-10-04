import "server-only";
/**
 * Data atlet (tab Train) untuk API member. Pintu masuk stabil: isi dipecah
 * per tanggung jawab, modul ini hanya mengekspor ulang API publiknya.
 * - athlete-views: bentuk respons, AthleteError, pemetaan baris → view
 * - athlete-store: kueri bersama (aktivitas, atlet, follow, kartu, segment)
 * - athlete-activities-server: feed, aktivitas, kudos, komentar
 * - athlete-records-server: rute, heatmap, gear, pengaturan, statistik, segment
 * - athlete-community-server: tantangan, klub, follow, profil
 */
export {
  AthleteError,
  type ActivityCardView,
  type ActivityCommentView,
  type ActivityDetailView,
  type ActivityPatch,
  type AthleteLite,
  type AthleteSettingsView,
  type AthleteStatsView,
  type ChallengeView,
  type GearInput,
  type GearView,
  type RouteView,
  type SaveActivityInput,
  type SegmentView,
} from "./athlete-views";
export { syncWorkoutActivities } from "./athlete-store";
export {
  activityDetail,
  addComment,
  deleteActivity,
  feed,
  myActivities,
  saveActivity,
  toggleKudos,
  updateActivity,
} from "./athlete-activities-server";
export {
  deleteRoute,
  gearList,
  getSettings,
  heatmap,
  routes,
  saveRoute,
  segmentDetail,
  segments,
  stats,
  updateSettings,
  upsertGear,
} from "./athlete-records-server";
export {
  challenges,
  clubs,
  joinChallenge,
  leaveChallenge,
  profile,
  social,
  toggleClub,
  toggleFollow,
} from "./athlete-community-server";
