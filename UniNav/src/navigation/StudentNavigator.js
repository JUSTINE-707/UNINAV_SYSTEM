import { createNativeStackNavigator } from '@react-navigation/native-stack'

import StudentTabs from './StudentTabs'
import StudentMapScreen from '../screens/studentSrc/StudentMapScreen'
import OfficialsScreen from '../screens/studentSrc/OfficialsScreen'

const Stack = createNativeStackNavigator()

const StudentNavigator = () => {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="StudentTabs" component={StudentTabs} />
      <Stack.Screen name="StudentMap" component={StudentMapScreen} />
      <Stack.Screen name="Officials" component={OfficialsScreen} />
    </Stack.Navigator>
  )
}

export default StudentNavigator