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
} from 'react-native'
import { StatusBar } from 'expo-status-bar'
import { COLORS, FONTS, SIZES } from '../../constants/theme'

const LoginScreen = ({ navigation }) => {
  const [inputEmail, setInputEmail] = useState('')
  const [inputPassword, setInputPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  const handleLogin = () => {
    if (inputEmail === 'professor@bsu.edu.ph' && inputPassword === 'professor123') {
      navigation.navigate('ProfessorDashboard')
    } else if (inputEmail === 'student@bsu.edu.ph' && inputPassword === 'student123') {
      navigation.navigate('StudentDashboard')
    } else {
      alert('Invalid email or password. Please try again.')
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

          {/* Email */}
          <View style={styles.inputContainer}>
            <Text style={styles.inputLabel}>Email</Text>
            <TextInput
              style={styles.input}
              placeholder="Enter your email"
              placeholderTextColor={COLORS.gray}
              keyboardType="email-address"
              autoCapitalize="none"
              value={inputEmail}
              onChangeText={setInputEmail}
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
                <Text style={styles.showPasswordText}>
                  {showPassword ? 'Hide' : 'Show'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Login Button */}
          <TouchableOpacity style={styles.loginButton} onPress={handleLogin}>
            <Text style={styles.loginButtonText}>LOGIN</Text>
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
})

export default LoginScreen