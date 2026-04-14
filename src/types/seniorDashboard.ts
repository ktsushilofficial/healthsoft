/**
 * Raw device row from GET /api/v1/senior-dashboard/{seniorId}.
 * Telemetry uses dotted field names from the backend.
 */
export type SeniorDashboardDeviceRecord = Record<string, unknown>;

export interface SeniorDashboardApiResponse {
  deviceStatusEventDTOs?: SeniorDashboardDeviceRecord[];
}
