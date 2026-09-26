import { createBottomTabNavigator } from '@react-navigation/bottom-tabs'
import { View, StyleSheet } from 'react-native'
import { Feather } from '@expo/vector-icons'

import StudentDashboard from '../screens/studentSrc/studentDashboard'
import StudentScheduleScreen from '../screens/studentSrc/StudentScheduleScreen'
import StudentSettingsScreen from '../screens/studentSrc/StudentSettingsScreen'

const Tab = createBottomTabNavigator()

// ============================================================
// TUNE THESE
// ============================================================

// Match the quick-action Feather icon size on the dashboard.
// Quick actions use 20. Feather glyphs render slightly tighter
// than emoji at the same size, so 22 reads as visually equal.
const ICON_SIZE = 22

const ACTIVE = '#8B0000'
const INACTIVE = '#9CA3AF'

const TabIcon = ({ name, focused }) => (
  <View style={styles.tabIconWrap}>
    <Feather
      name={name}
      size={ICON_SIZE}
      color={focused ? ACTIVE : INACTIVE}
    />
    {focused && <View style={styles.tabIconDot} />}
  </View>
)

const StudentTabs = () => {
  return (
    <Tab.Navigator
      initialRouteName="Home"
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: ACTIVE,
        tabBarInactiveTintColor: INACTIVE,
        tabBarStyle: {
          height: 64,
          paddingBottom: 8,
          paddingTop: 8,
          borderTopWidth: 1,
          borderTopColor: '#ECECEC',
          backgroundColor: '#FFFFFF',
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '700',
          marginTop: 2,
        },
      }}
    >
      <Tab.Screen
        name="Home"
        component={StudentDashboard}
        options={{
          tabBarLabel: 'Home',
          tabBarIcon: ({ focused }) => (
            <TabIcon name="home" focused={focused} />
          ),
        }}
      />
      <Tab.Screen
        name="Schedule"
        component={StudentScheduleScreen}
        options={{
          tabBarLabel: 'Schedule',
          tabBarIcon: ({ focused }) => (
            <TabIcon name="calendar" focused={focused} />
          ),
        }}
      />
      <Tab.Screen
        name="Settings"
        component={StudentSettingsScreen}
        options={{
          tabBarLabel: 'Settings',
          tabBarIcon: ({ focused }) => (
            <TabIcon name="settings" focused={focused} />
          ),
        }}
      />
    </Tab.Navigator>
  )
}

const styles = StyleSheet.create({
  tabIconWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    height: ICON_SIZE + 4,
    width: ICON_SIZE + 12,
  },
  tabIconDot: {
    position: 'absolute',
    bottom: -2,
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: ACTIVE,
  },
})

export default StudentTabs