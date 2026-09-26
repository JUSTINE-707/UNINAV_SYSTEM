import { useState } from 'react'
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
} from 'react-native'
import { Feather } from '@expo/vector-icons'
import { supabase } from '../../services/supabase'

const COLORS = {
  primary: '#8B0000',
  white: '#FFFFFF',
  black: '#1C1C1E',
  gray: '#9A9A9E',
  lightGray: '#E8E5DF',
  background: '#F7F5F2',
  error: '#B00020',
  success: '#2E8B22',
  warning: '#B26A00',
}

// ============================================================
// ERROR HANDLING
// ============================================================
//
// Note: We use `isRegisterError` flag instead of `instanceof`
// because React Native's Hermes engine breaks `instanceof` for
// custom classes that extend Error.
// ============================================================

class RegisterError extends Error {
  constructor(code, title, message, hint = '', severity = 'error') {
    super(message)
    this.name = 'RegisterError'
    this.isRegisterError = true   // ← duck-typing flag (instanceof-safe)
    this.code = code
    this.title = title
    this.hint = hint
    this.severity = severity
  }
}

const toRegisterFailure = (err) => {
  // 1. Our own typed error — check the FLAG, not instanceof
  if (err?.isRegisterError === true) {
    return {
      code: err.code,
      title: err.title,
      message: err.message,
      hint: err.hint,
      severity: err.severity,
    }
  }

  const msg = (err?.message || '').toString()
  const pgCode = err?.code
  const errName = err?.name || ''

  // ---- Network errors ----
  if (
    /network request failed|failed to fetch|timed? ?out|timeout/i.test(msg) ||
    errName === 'TypeError'
  ) {
    return {
      code: 'NETWORK',
      title: 'No connection',
      message: "We couldn't reach the server.",
      hint: 'Check your internet connection and try again.',
      severity: 'warning',
    }
  }

  // ---- Auth errors (Supabase) ----
  if (/user already registered/i.test(msg)) {
    return {
      code: 'ALREADY_REGISTERED',
      title: 'Email already registered',
      message: 'This email already has an account.',
      hint: 'Try logging in instead, or use a different email.',
      severity: 'warning',
    }
  }

  if (/password.*(least|short|weak)/i.test(msg)) {
    return {
      code: 'WEAK_PASSWORD',
      title: 'Password too weak',
      message: 'Please use a stronger password.',
      hint: 'Use at least 6 characters, mixing letters and numbers.',
      severity: 'warning',
    }
  }

  if (/invalid email|email.*invalid/i.test(msg)) {
    return {
      code: 'INVALID_EMAIL',
      title: 'Invalid email',
      message: 'Please double-check your email address.',
      hint: 'Make sure it follows the format name@domain.com.',
      severity: 'warning',
    }
  }

  // ---- Postgres errors ----
  if (pgCode === '23505') {
    if (/users.*email/i.test(msg) || /users_email_key/i.test(msg)) {
      return {
        code: 'DUPLICATE_EMAIL',
        title: 'Email already in use',
        message: 'This email is already registered in our system.',
        hint: 'Try logging in, or use a different email address.',
        severity: 'warning',
      }
    }
    if (/students.*sr_code/i.test(msg) || /sr_code/i.test(msg)) {
      return {
        code: 'DUPLICATE_SR',
        title: 'SR Code already used',
        message: 'This SR Code is already linked to an account.',
        hint: 'If this is yours, try logging in. Otherwise, contact the admin.',
        severity: 'warning',
      }
    }
    return {
      code: 'DUPLICATE',
      title: 'Already registered',
      message: 'Some of your details are already in use.',
      hint: 'Try logging in or contact the admin for help.',
      severity: 'warning',
    }
  }

  if (pgCode === '23503') {
    return {
      code: 'FK_VIOLATION',
      title: 'Account setup incomplete',
      message: 'Your account was created but something went wrong linking it.',
      hint: 'Please contact the admin to fix your account.',
      severity: 'error',
    }
  }

  if (pgCode === '23502') {
    return {
      code: 'MISSING_FIELD',
      title: 'Missing information',
      message: 'Some required information is missing.',
      hint: 'Try filling out all the fields again.',
      severity: 'warning',
    }
  }

  if (pgCode === '42501') {
    return {
      code: 'PERMISSION',
      title: 'Access denied',
      message: "Your account isn't allowed to do that yet.",
      hint: 'Please contact your administrator.',
      severity: 'error',
    }
  }

  if (pgCode === '42P01' || pgCode === 'PGRST205') {
    return {
      code: 'NOT_SET_UP',
      title: 'Feature not ready',
      message: 'Registration is not fully set up on the server yet.',
      hint: 'Please contact your administrator.',
      severity: 'error',
    }
  }

  if (pgCode === 'PGRST202' || /could not find the function/i.test(msg)) {
    return {
      code: 'RPC_MISSING',
      title: 'Server misconfigured',
      message: 'A required server function is missing.',
      hint: 'Please contact your administrator to run the setup scripts.',
      severity: 'error',
    }
  }

  // ---- Postgres raise from RPC (with details/hint) ----
  if (err?.details || err?.hint) {
    return {
      code: 'DATABASE',
      title: 'Registration failed',
      message: msg || 'Something went wrong.',
      hint: err?.hint || 'Please try again or contact the admin.',
      severity: 'error',
    }
  }

  // ---- Unknown fallback ----
  return {
    code: 'UNKNOWN',
    title: 'Registration failed',
    message: msg || 'Something went wrong during registration.',
    hint: 'Please try again. If it keeps happening, contact the admin.',
    severity: 'error',
  }
}

// ============================================================
// SCREEN
// ============================================================

const RegisterScreen = ({ navigation }) => {
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [srCode, setSrCode] = useState('')
  const [role, setRole] = useState('student')

  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)

  const [loading, setLoading] = useState(false)
  const [failure, setFailure] = useState(null)
  const [notice, setNotice] = useState(null)

  // ---- helpers ----
  const clearFeedback = () => {
    if (failure) setFailure(null)
    if (notice) setNotice(null)
  }

  const fail = (title, message, hint = '', severity = 'warning') => {
    setFailure({ code: 'VALIDATION', title, message, hint, severity })
  }

  // ============================================================
  // VALIDATION
  // ============================================================

  const validate = () => {
    if (!fullName.trim()) {
      fail('Missing name', 'Please enter your full name.')
      return false
    }
    if (!email.trim()) {
      fail('Missing email', 'Please enter your email address.')
      return false
    }
    if (!email.includes('@') || !email.includes('.')) {
      fail('Invalid email', 'Please enter a valid email address.')
      return false
    }
    if (role === 'student' && !srCode.trim()) {
      fail('Missing SR Code', 'Please enter your SR Code.')
      return false
    }
    if (!password) {
      fail('Missing password', 'Please enter a password.')
      return false
    }
    if (password.length < 6) {
      fail(
        'Password too short',
        'Your password must be at least 6 characters.',
        'Try mixing letters and numbers for a stronger password.'
      )
      return false
    }
    if (password !== confirmPassword) {
      fail(
        'Passwords do not match',
        'The two passwords you entered are different.',
        'Make sure both fields have the same password.'
      )
      return false
    }
    return true
  }

  // ============================================================
  // REGISTER
  // ============================================================

  const handleRegister = async () => {
    clearFeedback()

    if (!validate()) return

    setLoading(true)

    try {
      const cleanEmail = email.trim().toLowerCase()
      let rosterEntry = null

      // ---- Step 1: Verify against the appropriate roster ----
      if (role === 'student') {
        const { data, error: rpcError } = await supabase.rpc(
          'lookup_student_roster',
          {
            email_input: cleanEmail,
            sr_code_input: srCode.trim(),
          }
        )

        if (rpcError) throw rpcError

        if (!data) {
          throw new RegisterError(
            'ROSTER_NOT_FOUND',
            'Not on the student roster',
            "We couldn't find a matching record for your email and SR Code.",
            'Contact your Program Chair or the Registrar to be added to the roster first.',
            'warning'
          )
        }

        rosterEntry = data
      } else {
        const { data, error: rpcError } = await supabase.rpc(
          'lookup_faculty_roster',
          { email_input: cleanEmail }
        )

        if (rpcError) throw rpcError

        if (!data) {
          throw new RegisterError(
            'ROSTER_NOT_FOUND',
            'Not on the faculty roster',
            "We couldn't find your email in the faculty roster.",
            'Contact the Admin to be added to the faculty roster first.',
            'warning'
          )
        }

        rosterEntry = data
      }

      // ---- Step 2: Use roster's canonical name ----
      const rosterName = (rosterEntry.full_name || '').trim()
      const canonicalName = rosterName || fullName.trim().toUpperCase()

      if (rosterName && rosterName !== fullName) {
        setFullName(rosterName)
      }

      // ---- Step 3: Create auth account ----
      const { data: authData, error: authError } =
        await supabase.auth.signUp({
          email: cleanEmail,
          password,
        })

      if (authError) throw authError

      if (!authData.user) {
        throw new RegisterError(
          'AUTH_FAILED',
          'Could not create account',
          'Supabase did not return a user.',
          'Please try again. If it keeps happening, contact the admin.',
          'error'
        )
      }

      const userId = authData.user.id

      // ---- Step 4: Create public.users row ----
      const { error: userError } = await supabase
        .from('users')
        .insert({
          id: userId,
          full_name: canonicalName,
          email: cleanEmail,
          role,
        })

      if (userError) throw userError

      // ---- Step 5: Role-specific row + roster link ----
      if (role === 'student') {
        const { error: studentError } = await supabase
          .from('students')
          .insert({
            id: userId,
            sr_code: rosterEntry.sr_code,
            course: rosterEntry.course || null,
          })

        if (studentError) throw studentError

        const { error: linkError } = await supabase.rpc(
          'claim_student_roster',
          {
            p_user_id: userId,
            p_sr_code: rosterEntry.sr_code,
          }
        )

        if (linkError) throw linkError
      }

      if (role === 'faculty') {
        const { error: facultyError } = await supabase
          .from('faculty')
          .insert({
            id: userId,
            program: rosterEntry.program || null,
            college: rosterEntry.college || null,
          })

        if (facultyError) throw facultyError

        const { error: linkError } = await supabase.rpc(
          'claim_faculty_roster',
          {
            p_user_id: userId,
            p_email: cleanEmail,
          }
        )

        if (linkError) throw linkError
      }

      // ---- Success ----
      setNotice({
        type: 'success',
        message: 'Account created successfully. Redirecting to login…',
      })

      setEmail('')
      setPassword('')
      setConfirmPassword('')
      setSrCode('')

      setTimeout(() => {
        navigation.navigate('Login')
      }, 1500)
    } catch (error) {
      // Log only non-user-facing details — expected warnings go to
      // console.log, unexpected ones to console.error
      const isExpected =
        error?.isRegisterError === true || error?.severity === 'warning'

      if (isExpected) {
        console.log(
          '[Register] Expected outcome:',
          error?.code || error?.name,
          '-',
          error?.message
        )
      } else {
        console.error('[Register] Unexpected error:', error)
      }

      setFailure(toRegisterFailure(error))
    } finally {
      setLoading(false)
    }
  }

  // ============================================================
  // RENDER
  // ============================================================

  const isWarning = failure?.severity === 'warning'
  const accentColor = isWarning ? COLORS.warning : COLORS.error

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.formContainer}>
        <Text style={styles.title}>Create Account</Text>
        <Text style={styles.subtitle}>Register your UniNav account</Text>

        {/* ERROR / WARNING BOX */}
        {failure ? (
          <View
            style={[
              styles.alertBox,
              isWarning ? styles.alertWarning : styles.alertError,
            ]}
          >
            <View
              style={[
                styles.alertIconWrap,
                isWarning ? styles.alertIconWarn : styles.alertIconErr,
              ]}
            >
              <Text style={styles.alertIconText}>
                {isWarning ? '!' : '✕'}
              </Text>
            </View>

            <View style={{ flex: 1 }}>
              <Text style={[styles.alertTitle, { color: accentColor }]}>
                {failure.title}
              </Text>
              <Text style={styles.alertMessage}>{failure.message}</Text>
              {!!failure.hint && (
                <Text style={styles.alertHint}>{failure.hint}</Text>
              )}
            </View>

            <TouchableOpacity
              onPress={() => setFailure(null)}
              style={styles.alertClose}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Text style={styles.alertCloseText}>✕</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {/* SUCCESS NOTICE */}
        {notice ? (
          <View style={[styles.alertBox, styles.alertSuccess]}>
            <View style={[styles.alertIconWrap, styles.alertIconOk]}>
              <Text style={styles.alertIconText}>✓</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.alertTitle, { color: COLORS.success }]}>
                Success
              </Text>
              <Text style={styles.alertMessage}>{notice.message}</Text>
            </View>
          </View>
        ) : null}

        {/* FULL NAME */}
        <View style={styles.inputContainer}>
          <Text style={styles.inputLabel}>Full Name</Text>
          <TextInput
            style={styles.input}
            placeholder="SURNAME, FIRST NAME M."
            placeholderTextColor={COLORS.gray}
            value={fullName}
            onChangeText={(t) => {
              setFullName(t.toUpperCase())
              clearFeedback()
            }}
            autoCapitalize="characters"
          />
          <Text style={styles.helperText}>
            Must match your record in the{' '}
            {role === 'student' ? 'student' : 'faculty'} roster.
          </Text>
        </View>

        {/* EMAIL */}
        <View style={styles.inputContainer}>
          <Text style={styles.inputLabel}>Email</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. name@batstate-u.edu.ph"
            placeholderTextColor={COLORS.gray}
            value={email}
            onChangeText={(t) => {
              setEmail(t.toLowerCase())
              clearFeedback()
            }}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>

        {/* ROLE */}
        <View style={styles.inputContainer}>
          <Text style={styles.inputLabel}>Account Type</Text>
          <View style={styles.roleContainer}>
            <TouchableOpacity
              style={[
                styles.roleButton,
                role === 'student' && styles.roleButtonActive,
              ]}
              onPress={() => {
                setRole('student')
                clearFeedback()
              }}
            >
              <Text
                style={[
                  styles.roleText,
                  role === 'student' && styles.roleTextActive,
                ]}
              >
                Student
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.roleButton,
                role === 'faculty' && styles.roleButtonActive,
              ]}
              onPress={() => {
                setRole('faculty')
                clearFeedback()
              }}
            >
              <Text
                style={[
                  styles.roleText,
                  role === 'faculty' && styles.roleTextActive,
                ]}
              >
                Faculty
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* SR CODE (students only) */}
        {role === 'student' && (
          <View style={styles.inputContainer}>
            <Text style={styles.inputLabel}>SR Code</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. 2023-00123"
              placeholderTextColor={COLORS.gray}
              value={srCode}
              onChangeText={(t) => {
                setSrCode(t)
                clearFeedback()
              }}
              autoCapitalize="characters"
            />
            <Text style={styles.helperText}>
              Must match your record in the student roster.
            </Text>
          </View>
        )}

        {/* PASSWORD */}
        <View style={styles.inputContainer}>
          <Text style={styles.inputLabel}>Password</Text>
          <View style={styles.passwordWrapper}>
            <TextInput
              style={[styles.input, styles.passwordInput]}
              placeholder="At least 6 characters"
              placeholderTextColor={COLORS.gray}
              value={password}
              onChangeText={(t) => {
                setPassword(t)
                clearFeedback()
              }}
              secureTextEntry={!showPassword}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TouchableOpacity
              style={styles.showPasswordButton}
              onPress={() => setShowPassword((v) => !v)}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Feather
                name={showPassword ? 'eye-off' : 'eye'}
                size={20}
                color="#9E9E9E"
              />
            </TouchableOpacity>
          </View>
        </View>

        {/* CONFIRM PASSWORD */}
        <View style={styles.inputContainer}>
          <Text style={styles.inputLabel}>Confirm Password</Text>
          <View style={styles.passwordWrapper}>
            <TextInput
              style={[styles.input, styles.passwordInput]}
              placeholder="Re-enter your password"
              placeholderTextColor={COLORS.gray}
              value={confirmPassword}
              onChangeText={(t) => {
                setConfirmPassword(t)
                clearFeedback()
              }}
              secureTextEntry={!showConfirm}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TouchableOpacity
              style={styles.showPasswordButton}
              onPress={() => setShowConfirm((v) => !v)}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Feather
                name={showConfirm ? 'eye-off' : 'eye'}
                size={20}
                color="#9E9E9E"
              />
            </TouchableOpacity>
          </View>
        </View>

        {/* REGISTER BUTTON */}
        <TouchableOpacity
          style={[
            styles.registerButton,
            loading && styles.registerButtonDisabled,
          ]}
          onPress={handleRegister}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color={COLORS.white} />
          ) : (
            <Text style={styles.registerButtonText}>Create Account</Text>
          )}
        </TouchableOpacity>

        <Text style={styles.rosterHint}>
          Not on the roster yet? Contact your Program Chair or the Admin
          to be added first.
        </Text>

        {/* LOGIN */}
        <View style={styles.loginContainer}>
          <Text style={styles.loginText}>Already have an account?</Text>
          <TouchableOpacity onPress={() => navigation.navigate('Login')}>
            <Text style={styles.loginLink}>Login</Text>
          </TouchableOpacity>
        </View>
      </View>
    </ScrollView>
  )
}

// ============================================================
// STYLES
// ============================================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 24,
  },
  formContainer: {
    width: '100%',
    maxWidth: 500,
    alignSelf: 'center',
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: COLORS.black,
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 14,
    color: COLORS.gray,
    marginBottom: 24,
  },

  // ---- Inputs ----
  inputContainer: {
    marginBottom: 16,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.black,
    marginBottom: 7,
  },
  input: {
    height: 50,
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.lightGray,
    borderRadius: 10,
    paddingHorizontal: 14,
    fontSize: 15,
    color: COLORS.black,
  },
  helperText: {
    fontSize: 11,
    color: COLORS.gray,
    marginTop: 6,
    fontStyle: 'italic',
  },

  // ---- Password with eye toggle ----
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

  // ---- Role selector ----
  roleContainer: {
    flexDirection: 'row',
    gap: 10,
  },
  roleButton: {
    flex: 1,
    height: 48,
    borderWidth: 1,
    borderColor: COLORS.lightGray,
    borderRadius: 10,
    backgroundColor: COLORS.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roleButtonActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  roleText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.black,
  },
  roleTextActive: {
    color: COLORS.white,
  },

  // ---- Register button ----
  registerButton: {
    height: 52,
    backgroundColor: COLORS.primary,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  registerButtonDisabled: {
    opacity: 0.7,
  },
  registerButtonText: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: '700',
  },

  // ---- Feedback alerts ----
  alertBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: 14,
    borderRadius: 12,
    marginBottom: 16,
    borderWidth: 1,
  },
  alertError: {
    backgroundColor: '#FDECEC',
    borderColor: '#F5B5B5',
  },
  alertWarning: {
    backgroundColor: '#FFF6E0',
    borderColor: '#F0D58C',
  },
  alertSuccess: {
    backgroundColor: '#EAF6EC',
    borderColor: '#A7F3D0',
  },

  alertIconWrap: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginTop: 1,
  },
  alertIconErr: { backgroundColor: COLORS.error },
  alertIconWarn: { backgroundColor: COLORS.warning },
  alertIconOk: { backgroundColor: COLORS.success },
  alertIconText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '900',
    lineHeight: 13,
  },

  alertTitle: {
    fontSize: 13,
    fontWeight: '800',
    marginBottom: 3,
  },
  alertMessage: {
    fontSize: 12,
    color: COLORS.black,
    lineHeight: 17,
    fontWeight: '600',
  },
  alertHint: {
    fontSize: 11,
    color: '#6B7280',
    marginTop: 4,
    lineHeight: 16,
    fontStyle: 'italic',
  },
  alertClose: {
    paddingHorizontal: 4,
    paddingVertical: 2,
    flexShrink: 0,
  },
  alertCloseText: {
    fontSize: 14,
    color: COLORS.gray,
    fontWeight: '700',
  },

  // ---- Roster hint ----
  rosterHint: {
    fontSize: 11,
    color: COLORS.gray,
    textAlign: 'center',
    marginTop: 16,
    fontStyle: 'italic',
    lineHeight: 16,
    paddingHorizontal: 12,
  },

  // ---- Login footer ----
  loginContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 20,
    gap: 5,
  },
  loginText: {
    color: COLORS.gray,
    fontSize: 14,
  },
  loginLink: {
    color: COLORS.primary,
    fontSize: 14,
    fontWeight: '700',
  },
})

export default RegisterScreen