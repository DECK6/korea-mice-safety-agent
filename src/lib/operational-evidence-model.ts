import type { ApiAccessStatus } from "./api-access-status.js";

export type OperationalSourceStatus =
  | "configured"
  | "not_configured"
  | "pending_key"
  | "unsupported_region"
  | "unavailable"
  | "live_error"
  | "live_call_skipped";

export type OperationalFreshnessMode = "live" | "fallback" | "not_collected";

export type OperationalObservationLevel = "info" | "watch" | "warning" | "critical";

export interface OperationalObservation {
  kind: string;
  level: OperationalObservationLevel;
  summary: string;
  advisoryOnly: true;
}

export interface OperationalEvidenceFreshness {
  mode: OperationalFreshnessMode;
  ttlMinutes: number;
  isStale: boolean;
}

export interface OperationalEvidenceLocation {
  venueId?: string;
  jurisdiction?: string;
  latitude?: number;
  longitude?: number;
}

export function sourceStatusFromApiAccess(status: ApiAccessStatus): OperationalSourceStatus {
  if (status === "configured") return "configured";
  if (status === "pending") return "pending_key";
  return "not_configured";
}

export function isSeoulJurisdiction(jurisdiction?: string): boolean {
  return Boolean(jurisdiction && /서울/.test(jurisdiction));
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

export function isExpired(expiresAt: string, now = new Date()): boolean {
  return new Date(expiresAt).getTime() <= now.getTime();
}
