import { useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { Feather } from '@expo/vector-icons'
import { supabase } from '../../services/supabase'
import { useAuth } from '../../context/AuthContext'

const T = {
  crimson: '#8B0000',
  crimsonSoft: '#FCECEC',
  ink: '#171719',
  muted: '#71717A',
  faint: '#A1A1AA',
  border: '#E7E7E9',
  canvas: '#F2F2F4',
  white: '#FFFFFF',
  green: '#0F7A4A',
}

const StudentSettingsScreen = ({ navigation }) => {
  const { session, user, role } = useAuth()
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  const loadProfile = useCallback(async () => {
    const account = user || session?.user
    if (!account?.id) {
      setProfile(null)
      setLoading(false)
      return
    }

    setLoading(true)
    const [accountResult, rosterResult] = await Promise.all([
      supabase
        .from('users')
        .select('full_name, email, role')
        .eq('id', account.id)
        .maybeSingle(),
      supabase
        .from('students_roster')
        .select('sr_code, full_name, course')
        .eq('user_id', account.id)
        .maybeSingle(),
    ])

    if (accountResult.error) {
      console.warn('[StudentSettings] account fetch:', accountResult.error.message)
    }
    if (rosterResult.error) {
      console.warn('[StudentSettings] roster fetch:', rosterResult.error.message)
    }

    setProfile({
      fullName:
        rosterResult.data?.full_name ||
        accountResult.data?.full_name ||
        account.user_metadata?.full_name ||
        '',
      email: accountResult.data?.email || account.email || '',
      role: accountResult.data?.role || role || 'student',
      srCode: rosterResult.data?.sr_code || '',
      course: rosterResult.data?.course || '',
    })
    setLoading(false)
  }, [role, session, user])

  useEffect(() => {
    loadProfile()
  }, [loadProfile])

  const handleLogout = async () => {
    const { error } = await supabase.auth.signOut()
    if (error) {
      Alert.alert('Could not log out', error.message)
      return
    }
    navigation.reset({ index: 0, routes: [{ name: 'Login' }] })
  }

  const initials = (profile?.fullName || profile?.email || 'S')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.pageHeader}>
          <Text style={styles.eyebrow}>YOUR ACCOUNT</Text>
          <Text style={styles.header}>Settings</Text>
          <Text style={styles.subtitle}>Account and student information</Text>
        </View>

        <View style={styles.profileCard}>
          {loading ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator color={T.crimson} />
              <Text style={styles.loadingText}>Loading your account…</Text>
            </View>
          ) : (
            <>
              <View style={styles.identityRow}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{initials}</Text>
                </View>
                <View style={styles.identityText}>
                  <Text style={styles.name} numberOfLines={2}>
                    {profile?.fullName || 'Student account'}
                  </Text>
                  <Text style={styles.email} numberOfLines={1}>
                    {profile?.email || 'No email available'}
                  </Text>
                </View>
                <View style={styles.activeMark}>
                  <Feather name="check" size={13} color={T.green} />
                </View>
              </View>

              <View style={styles.divider} />

              <Text style={styles.sectionLabel}>STUDENT DETAILS</Text>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>SR CODE</Text>
                <Text style={styles.detailValue}>
                  {profile?.srCode || 'Not available'}
                </Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>PROGRAM</Text>
                <Text style={styles.detailValue} numberOfLines={2}>
                  {profile?.course || 'Not assigned'}
                </Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>ACCOUNT TYPE</Text>
                <Text style={styles.detailValue}>
                  {(profile?.role || 'student').toUpperCase()}
                </Text>
              </View>
            </>
          )}
        </View>

        <Text style={styles.sectionLabel}>CAMPUS</Text>
        <TouchableOpacity
          style={styles.linkRow}
          onPress={() => navigation.navigate('Officials')}
          activeOpacity={0.75}
        >
          <View style={styles.linkIcon}>
            <Feather name="users" size={18} color={T.crimson} />
          </View>
          <View style={styles.linkCopy}>
            <Text style={styles.linkTitle}>University Officials</Text>
            <Text style={styles.linkSubtitle}>Browse the campus directory</Text>
          </View>
          <Feather name="chevron-right" size={18} color={T.faint} />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.logoutButton}
          onPress={handleLogout}
          activeOpacity={0.8}
        >
          <Feather name="log-out" size={17} color={T.crimson} />
          <Text style={styles.logoutText}>Log out</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: T.canvas },
  content: { padding: 20, paddingTop: 30, paddingBottom: 28 },
  pageHeader: { marginBottom: 22 },
  eyebrow: {
    color: T.crimson,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
    marginBottom: 5,
  },
  header: { fontSize: 28, fontWeight: '800', color: T.ink },
  subtitle: { color: T.muted, fontSize: 13, marginTop: 4 },
  profileCard: {
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.border,
    borderRadius: 8,
    padding: 16,
    marginBottom: 24,
  },
  loadingRow: { minHeight: 110, flexDirection: 'row', alignItems: 'center', gap: 12 },
  loadingText: { color: T.muted, fontSize: 13 },
  identityRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: T.crimsonSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: T.crimson, fontSize: 16, fontWeight: '800' },
  identityText: { flex: 1, minWidth: 0 },
  name: { color: T.ink, fontSize: 15, fontWeight: '800' },
  email: { color: T.muted, fontSize: 12, marginTop: 3 },
  activeMark: {
    width: 25,
    height: 25,
    borderRadius: 13,
    backgroundColor: '#ECFDF5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  divider: { height: 1, backgroundColor: T.border, marginVertical: 16 },
  sectionLabel: {
    color: T.faint,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.8,
    marginBottom: 10,
  },
  detailRow: {
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  detailLabel: { color: T.muted, fontSize: 10, fontWeight: '700' },
  detailValue: {
    color: T.ink,
    flex: 1,
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'right',
  },
  linkRow: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.border,
    borderRadius: 8,
    paddingHorizontal: 14,
    marginBottom: 24,
  },
  linkIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: T.crimsonSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  linkCopy: { flex: 1, minWidth: 0 },
  linkTitle: { color: T.ink, fontSize: 13, fontWeight: '800' },
  linkSubtitle: { color: T.muted, fontSize: 11, marginTop: 3 },
  logoutButton: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    borderWidth: 1,
    borderColor: '#E6B8B8',
    borderRadius: 8,
    backgroundColor: T.white,
  },
  logoutText: { color: T.crimson, fontSize: 13, fontWeight: '800' },
})

export default StudentSettingsScreen