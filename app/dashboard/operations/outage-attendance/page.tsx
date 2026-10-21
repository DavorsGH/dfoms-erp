import OperationsShell from "../operations-shell";
import OutageAttendancePanel from "../../devices/outage-attendance-panel";

export default function OutageAttendancePage() {
  return (
    <OperationsShell sectionTitle="Outage attendance">
      <OutageAttendancePanel />
    </OperationsShell>
  );
}
