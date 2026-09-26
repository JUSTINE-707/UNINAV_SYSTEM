import { AuthProvider } from './src/context/AuthContext'
import { SemesterProvider } from './src/context/SemesterContext'
import AppNavigator from './src/navigation/AppNavigator'
import { GestureHandlerRootView } from 'react-native-gesture-handler'

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SemesterProvider>
        <AuthProvider>
          <AppNavigator />
        </AuthProvider>
      </SemesterProvider>
    </GestureHandlerRootView>
  )
}