import CampusMapScreen from '../../components/CampusMapScreen';

// Guests are not signed in, so this screen is a thin wrapper around
// CampusMapScreen with the account-only features switched off:
//  - no debug panel
//  - no "Scan QR at this room" button (needs a schedule + login)
//  - routes start from the main gate node
const GuestMapScreen = () => {
  return (
    <CampusMapScreen
      defaultStartLabel="G1-WP1"
      showDebugPanel={false}
      showScanQRAfterRoute={false}
      headerEyebrow="GUEST · CAMPUS MAP"
      browseHint="Search a building or room, or long-press the map to drop a pin"
    />
  )
}

export default GuestMapScreen