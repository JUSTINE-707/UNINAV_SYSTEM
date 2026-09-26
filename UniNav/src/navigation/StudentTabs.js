import { createBottomTabNavigator } from '@react-navigation/bottom-tabs'
import { Text, View, StyleSheet } from 'react-native'

import StudentDashboard from '../screens/studentSrc/studentDashboard'
import StudentScheduleScreen from '../screens/studentSrc/StudentScheduleScreen'
import StudentSettingsScreen from '../screens/studentSrc/StudentSettingsScreen'

const Tab = createBottomTabNavigator()

const TabIcon = ({ emoji, focused }) => (
  <View style={styles.tabIconWrap}>
    <Text style={[styles.tabIcon, focused && styles.tabIconActive]}>
      {emoji}
    </Text>
  </View>
)

const StudentTabs = () => {
  return (
    <Tab.Navigator
      initialRouteName="Home"
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#8B0000',
        tabBarInactiveTintColor: '#9CA3AF',
        tabBarStyle: {
          height: 64,
          paddingBottom: 8,
          paddingTop: 8,
          borderTopWidth: 1,
          borderTopColor: '#ECECEC',
          backgroundColor: '#FFFFFF',
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '700', marginTop: 2 },
      }}
    >
      <Tab.Screen
        name="Home"
        component={StudentDashboard}
        options={{
          tabBarLabel: 'Home',
          tabBarIcon: ({ focused }) => <TabIcon emoji="🏠" focused={focused} />,
        }}
      />
      <Tab.Screen
        name="Schedule"
        component={StudentScheduleScreen}
        options={{
          tabBarLabel: 'Schedule',
          tabBarIcon: ({ focused }) => <TabIcon emoji="📅" focused={focused} />,
        }}
      />
      <Tab.Screen
        name="Settings"
        component={StudentSettingsScreen}
        options={{
          tabBarLabel: 'Settings',
          tabBarIcon: ({ focused }) => <TabIcon emoji="⚙️" focused={focused} />,
        }}
      />
    </Tab.Navigator>
  )
}

const styles = StyleSheet.create({
  tabIconWrap: { alignItems: 'center', justifyContent: 'center' },
  tabIcon: { fontSize: 20, opacity: 0.5 },
  tabIconActive: { opacity: 1 },
})

export default StudentTabs