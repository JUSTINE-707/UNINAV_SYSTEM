import { NavigationContainer } from '@react-navigation/native'
import { createNativeStackNavigator } from '@react-navigation/native-stack'

import LoginScreen from '../screens/auth/LoginScreen'
import RegisterScreen from '../screens/auth/RegisterScreen'

import StudentNavigator from './StudentNavigator'
import { navigationRef } from './navigationRef'

import ProfessorDashboard from '../screens/professorSrc/ProfessorDashboard'
import QRScannerScreen from '../screens/professorSrc/QRScannerScreen'
import FacultyScheduleScreen from '../screens/professorSrc/FacultyScheduleScreen'
import ReportGhostScreen from '../screens/professorSrc/ReportGhostScreen'
import FacultyMapScreen from '../screens/professorSrc/FacultyMapScreen'
import EndClassEarlyScreen from '../screens/professorSrc/EndClassEarlyScreen'
import RoomStatusScreen from '../screens/professorSrc/RoomStatusScreen'

const Stack = createNativeStackNavigator()

const AppNavigator = () => {
  return (
    <NavigationContainer ref={navigationRef}>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Login" component={LoginScreen} />
        <Stack.Screen name="Register" component={RegisterScreen} />

        <Stack.Screen name="StudentDashboard" component={StudentNavigator} />

        <Stack.Screen name="ProfessorDashboard" component={ProfessorDashboard} />
        <Stack.Screen name="QRScanner" component={QRScannerScreen} />
        <Stack.Screen name="FacultySchedule" component={FacultyScheduleScreen} />
        <Stack.Screen name="ReportGhost" component={ReportGhostScreen} />
        <Stack.Screen name="Map" component={FacultyMapScreen} />
        <Stack.Screen name="EndClassEarly" component={EndClassEarlyScreen} />
        <Stack.Screen name="RoomStatus" component={RoomStatusScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  )
}

export default AppNavigator