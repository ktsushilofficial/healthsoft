/** One drug that was due at a missed pill-dispenser alarm. */
export interface MissedDoseDrug {
  drugName: string;
  drugAmount: string;
}

/** One row of GET /api/v1/guardian-dashboard/seniors/{seniorId}/missed-doses. */
export interface MissedDoseEvent {
  /** Local day of the alarm, `YYYY-MM-DD`. */
  date: string;
  /** Local alarm time, `HH:mm`. */
  alarmTime: string;
  deviceSn: string;
  drugs: MissedDoseDrug[];
  /** Epoch ms when the dispenser reported the miss. */
  reportedAt: number;
}
