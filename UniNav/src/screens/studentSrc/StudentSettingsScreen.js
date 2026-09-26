import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { supabase } from '../../services/supabase'
import { useAuth } from '../../context/AuthContext'

const StudentSettingsScreen = ({ navigation }) => {
  const { session } = useAuth()

  const handleLogout = async () => {
    await supabase.auth.signOut()
    navigation.reset({ index: 0, routes: [{ name: 'Login' }] })
  }

  return (
    <View style={styles.container}>
      <Text style={styles.header}>Settings</Text>
      <Text style={styles.email}>{session?.user?.email}</Text>

      {/* Future: change password, view SR code/course/section, Officials Directory link */}

      <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
        <Text style={styles.logoutText}>Logout</Text>
      </TouchableOpacity>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F7F5F2', padding: 20 },
  header: { fontSize: 24, fontWeight: 'bold', color: '#1C1C1E', marginBottom: 8 },
  email: { fontSize: 13, color: '#9A9A9E', marginBottom: 24 },
  logoutButton: { backgroundColor: '#8B0000', borderRadius: 10, padding: 14, alignItems: 'center', marginTop: 'auto' },
  logoutText: { color: '#fff', fontWeight: '700' },
})

export default StudentSettingsScreen