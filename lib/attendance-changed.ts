export const ATTENDANCE_CHANGED_EVENT = "dfoms-attendance-changed";

export function notifyAttendanceChanged() {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(new Event(ATTENDANCE_CHANGED_EVENT));
}
