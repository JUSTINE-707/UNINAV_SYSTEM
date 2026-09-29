import { useState } from 'react'
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator
} from 'react-native'
import { StatusBar } from 'expo-status-bar'
import { COLORS, FONTS, SIZES } from '../../constants/theme'
import { Feather } from '@expo/vector-icons'
import { supabase } from '../../services/supabase'

const LoginScreen = ({ navigation }) => {
  const [inputIdentifier, setInputIdentifier] = useState('')
  const [inputPassword, setInputPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  const handleLogin = async () => {
    setErrorMsg('');

    const identifier = inputIdentifier.trim();

    if (!identifier || !inputPassword) {
      setErrorMsg('Please enter your email/SR code and password.');
      return;
    }

    setLoading(true);

    let loginEmail = identifier;

    // If it doesn't look like an email, treat it as an SR code and look up the real email
    if (!identifier.includes('@')) {
      // Use a SECURITY DEFINER RPC so the lookup works before authentication
      // (bypasses RLS on students/users without exposing the tables)
      const { data: foundEmail, error: rpcError } = await supabase
        .rpc('lookup_email_by_sr_code', { sr_input: identifier });

      if (rpcError) {
        console.error('[login] SR lookup RPC error:', rpcError);
        setLoading(false);
        setErrorMsg(`Lookup error: ${rpcError.message || 'Could not reach server.'}`);
        return;
      }

      if (!foundEmail) {
        setLoading(false);
        setErrorMsg('No account found with that SR code.');
        return;
      }

      loginEmail = foundEmail;
    }

    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email: loginEmail,
      password: inputPassword,
    });

    if (authError) {
      setLoading(false)
      setErrorMsg(authError.message)
      return
    }

    // Step 2: look up their role from the users table
    const { data: profile, error: profileError } = await supabase
      .from('users')
      .select('role')
      .eq('id', authData.user.id)
      .single()

    setLoading(false)

    if (profileError || !profile) {
      setErrorMsg('Could not load your profile. Please try again.')
      return
    }

    // Step 3: route based on role
    switch (profile.role) {
      case 'student':
        navigation.navigate('StudentDashboard')
        break
      case 'faculty':
      case 'professor':  // Fallback: support both spellings
        navigation.navigate('ProfessorDashboard')
        break
      case 'chairperson':
        navigation.navigate('ChairpersonDashboard')
        break
      case 'admin':
        navigation.navigate('AdminDashboard')
        break
      default:
        setErrorMsg(`Unknown account role: ${profile.role}`)
    }
  }

  // Guests are not signed in. They can only view the campus map.
  const handleGuest = () => {
    setErrorMsg('')
    navigation.navigate('Map', { isGuest: true })
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 60}
    >
      <StatusBar style="light" />
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContainer}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >

        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.universityText}>
            Batangas State University
          </Text>
          <Text style={styles.campusText}>
            ARASOF - Nasugbu
          </Text>
          <View style={styles.divider} />
          <Text style={styles.appName}>UniNav</Text>
          <Text style={styles.appSubtitle}>
            Campus Navigation & Schedule System
          </Text>
        </View>

        {/* Form */}
        <View style={styles.form}>

          {errorMsg ? <Text style={styles.errorText}>{errorMsg}</Text> : null}

          {/* Email */}
          <View style={styles.inputContainer}>
            <Text style={styles.inputLabel}>Email/SR-Code</Text>
            <TextInput
              style={styles.input}
              placeholder="Email or SR Code"
              placeholderTextColor={COLORS.gray}
              keyboardType="default"
              autoCapitalize="none"
              autoCorrect={false}
              value={inputIdentifier}
              onChangeText={setInputIdentifier}
            />
          </View>

          {/* Password */}
          <View style={styles.inputContainer}>
            <Text style={styles.inputLabel}>Password</Text>
            <View style={styles.passwordWrapper}>
              <TextInput
                style={[styles.input, styles.passwordInput]}
                placeholder="Enter your password"
                placeholderTextColor={COLORS.gray}
                secureTextEntry={!showPassword}
                value={inputPassword}
                onChangeText={setInputPassword}
              />
              <TouchableOpacity
                style={styles.showPasswordButton}
                onPress={() => setShowPassword(prev => !prev)}
              >
                <Feather
                  name={showPassword ? 'eye-off' : 'eye'}
                  size={20}
                  color="#9E9E9E"
                />
              </TouchableOpacity>
            </View>
          </View>

          {/* Login Button */}
          <TouchableOpacity
            style={styles.loginButton}
            onPress={handleLogin}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color={COLORS.white} />
            ) : (
              <Text style={styles.loginButtonText}>LOGIN</Text>
            )}
          </TouchableOpacity>

          {/* Register Link */}
          <View style={styles.registerContainer}>
            <Text style={styles.registerText}>
              Don't have an account?{' '}
            </Text>
            <TouchableOpacity
              onPress={() => navigation.navigate('Register')}
            >
              <Text style={styles.registerLink}>Register</Text>
            </TouchableOpacity>
          </View>

          {/* Guest divider */}
          <View style={styles.orRow}>
            <View style={styles.orLine} />
            <Text style={styles.orText}>OR</Text>
            <View style={styles.orLine} />
          </View>

          {/* Guest Button */}
          <TouchableOpacity
            style={[styles.guestCard, loading && styles.guestCardDisabled]}
            onPress={handleGuest}
            disabled={loading}
            activeOpacity={0.75}
          >
            <View style={styles.guestIconChip}>
              <Feather name="map" size={20} color={COLORS.white} />
            </View>
            <View style={styles.guestTextWrap}>
              <Text style={styles.guestTitle}>Continue as Guest</Text>
              <Text style={styles.guestSubtitle}>
                Browse the campus map, no account needed
              </Text>
            </View>
            <Feather name="chevron-right" size={22} color={COLORS.primary} />
          </TouchableOpacity>

        </View>

      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.primary,
  },
  scrollContainer: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  header: {
    alignItems: 'center',
    paddingVertical: 40,
    paddingHorizontal: SIZES.padding,
  },
  universityText: {
    fontSize: FONTS.large,
    fontWeight: 'bold',
    color: COLORS.white,
    textAlign: 'center',
  },
  campusText: {
    fontSize: FONTS.medium,
    color: COLORS.secondary,
    marginTop: 4,
  },
  divider: {
    width: 60,
    height: 2,
    backgroundColor: COLORS.secondary,
    marginVertical: 16,
  },
  appName: {
    fontSize: 48,
    fontWeight: 'bold',
    color: COLORS.white,
    letterSpacing: 4,
  },
  appSubtitle: {
    fontSize: FONTS.small,
    color: COLORS.lightGray,
    textAlign: 'center',
    marginTop: 4,
  },
  form: {
    backgroundColor: COLORS.white,
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    paddingHorizontal: SIZES.padding,
    paddingTop: 30,
    paddingBottom: 40,
    flex: 1,
  },
  inputContainer: {
    marginBottom: 16,
  },
  inputLabel: {
    fontSize: FONTS.medium,
    fontWeight: '600',
    color: COLORS.black,
    marginBottom: 8,
  },
  input: {
    backgroundColor: COLORS.background,
    borderRadius: SIZES.borderRadius,
    padding: 14,
    fontSize: FONTS.medium,
    color: COLORS.black,
    borderWidth: 1,
    borderColor: COLORS.lightGray,
    flex: 1,
  },
  passwordWrapper: {
    position: 'relative',
  },
  passwordInput: {
    paddingRight: 48,
  },
  showPasswordButton: {
    position: 'absolute',
    right: 14,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  showPasswordText: {
    fontSize: 14,
    color: COLORS.primary,
    fontWeight: '600',
  },
  scrollView: {
    flex: 1,
  },
  loginButton: {
    backgroundColor: COLORS.primary,
    borderRadius: SIZES.borderRadius,
    padding: 16,
    alignItems: 'center',
    marginTop: 10,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  loginButtonText: {
    color: COLORS.white,
    fontSize: FONTS.medium,
    fontWeight: 'bold',
    letterSpacing: 2,
  },
  registerContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 20,
  },
  registerText: {
    color: COLORS.gray,
    fontSize: FONTS.medium,
  },
  registerLink: {
    color: COLORS.primary,
    fontSize: FONTS.medium,
    fontWeight: 'bold',
  },
  errorText: {
    color: '#D32F2F',
    fontSize: FONTS.medium,
    marginBottom: 12,
    textAlign: 'center',
  },

  // ==================== GUEST ====================
  orRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 24,
    marginBottom: 20,
  },
  orLine: {
    flex: 1,
    height: 1,
    backgroundColor: COLORS.lightGray,
  },
  orText: {
    marginHorizontal: 12,
    fontSize: FONTS.small,
    fontWeight: '700',
    color: COLORS.gray,
    letterSpacing: 1.5,
  },
  guestCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 14,
    borderRadius: SIZES.borderRadius + 4,
    borderWidth: 1,
    borderColor: '#F0C9C9',
    backgroundColor: '#FDF3F3',
  },
  guestCardDisabled: {
    opacity: 0.5,
  },
  guestIconChip: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  guestTextWrap: {
    flex: 1,
  },
  guestTitle: {
    fontSize: FONTS.medium,
    fontWeight: 'bold',
    color: COLORS.black,
  },
  guestSubtitle: {
    fontSize: FONTS.small,
    color: COLORS.gray,
    marginTop: 2,
    lineHeight: 16,
  },
})

export default LoginScreen