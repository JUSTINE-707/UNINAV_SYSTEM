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

    if (!inputIdentifier || !inputPassword) {
      setErrorMsg('Please enter your email/SR code and password.');
      return;
    }

    setLoading(true);

    let loginEmail = inputIdentifier;

    // If it doesn't look like an email, treat it as an SR code and look up the real email
    if (!inputIdentifier.includes('@')) {
      const { data: student, error: lookupError } = await supabase
        .from('students')
        .select('id, users(email)')
        .eq('sr_code', inputIdentifier)
        .single();

      if (lookupError || !student) {
        setLoading(false);
        setErrorMsg('No account found with that SR code.');
        return;
      }

      loginEmail = student.users.email;
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
      case 'professor':
        navigation.navigate('ProfessorDashboard')
        break
      case 'chairperson':
        navigation.navigate('ChairpersonDashboard') // web/desktop in your case, but keep for completeness
        break
      case 'admin':
        navigation.navigate('AdminDashboard')
        break
      default:
        setErrorMsg('Unknown account role.')
    }
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
})

export default LoginScreen