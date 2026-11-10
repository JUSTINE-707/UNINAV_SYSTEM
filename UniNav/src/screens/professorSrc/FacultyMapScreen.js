import CampusMapScreen from '../../components/CampusMapScreen';

export default function FacultyMapScreen() {
  return (
    <CampusMapScreen
      showDebugPanel={false}
      headerEyebrow="FACULTY NAVIGATION"
      defaultStartLabel="G1-WP1"
      showScanQRAfterRoute={true}
    />
  );
}