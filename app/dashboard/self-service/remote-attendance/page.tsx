import RemoteAttendancePanel from "../remote-attendance-panel";
import SelfServiceShell from "../self-service-shell";

export default function RemoteAttendancePage() {
  return (
    <SelfServiceShell sectionTitle="Log remote attendance">
      <RemoteAttendancePanel />
    </SelfServiceShell>
  );
}
