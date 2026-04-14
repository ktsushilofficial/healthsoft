import type { SeniorDashboardDeviceRecord } from './seniorDashboard';

/** One senior block inside GET /api/v1/guardian-dashboard/{guardianUserId}. */
export interface GuardianSeniorDetailsDTO {
  userId?: string;
  mappingId?: string;
  firstName?: string;
  lastName?: string;
  phoneNumber?: number;
  profileImageUrl?: string | null;
  mappingStatus?: string;
  mappingCreatedAt?: number;
  mappingUpdatedAt?: number;
  dateOfBirth?: number | null;
  height?: number | null;
  weight?: number | null;
  gender?: string | null;
}

export interface GuardianSeniorProfileRow {
  seniorDetailsDTO?: GuardianSeniorDetailsDTO | null;
  deviceStatusEventDTOs?: SeniorDashboardDeviceRecord[] | null;
}

export interface GuardianSeniorDevicePositionDTO {
  devicePositionEventDTOs?: SeniorDashboardDeviceRecord[] | null;
}

export interface GuardianSeniorDeviceAlarmDTO {
  deviceAlarmEventDTOs?: SeniorDashboardDeviceRecord[] | null;
}

export interface GuardianDashboardApiResponse {
  seniorProfilesDTO?: GuardianSeniorProfileRow[] | null;
  seniorDevicePositions?: GuardianSeniorDevicePositionDTO | null;
  seniorDeviceAlarms?: GuardianSeniorDeviceAlarmDTO | null;
}
