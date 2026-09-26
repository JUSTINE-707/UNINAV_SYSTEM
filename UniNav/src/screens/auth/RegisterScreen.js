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
}

const RegisterScreen = ({ navigation }) => {
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [srCode, setSrCode] = useState('')
  const [role, setRole] = useState('student')

  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [notice, setNotice] = useState(null)

  const handleRegister = async () => {
    setErrorMsg('')
    setNotice(null)

    // ============================================================
    // VALIDATION
    // ============================================================

    if (!fullName.trim() || !email.trim() || !password) {
      setErrorMsg('Please fill in all required fields.')
      return
    }

    if (!email.includes('@')) {
      setErrorMsg('Please enter a valid email address.')
      return
    }

    if (role === 'student' && !srCode.trim()) {
      setErrorMsg('Please enter your SR Code.')
      return
    }

    if (password.length < 6) {
      setErrorMsg('Password must be at least 6 characters.')
      return
    }

    if (password !== confirmPassword) {
      setErrorMsg('Passwords do not match.')
      return
    }

    setLoading(true)

    try {
      const cleanEmail = email.trim().toLowerCase()
      let rosterEntry = null

      // ============================================================
      // STEP 1: Verify against the appropriate roster
      // ============================================================

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
          throw new Error(
            "Your email and SR Code don't match any record in the student roster. Please contact the admin to be added first."
          )
        }

        rosterEntry = data
      } else {
        const { data, error: rpcError } = await supabase.rpc(
          'lookup_faculty_roster',
          {
            email_input: cleanEmail,
          }
        )

        if (rpcError) throw rpcError

        if (!data) {
          throw new Error(
            "Your email isn't in the faculty roster. Please contact the admin to be added first."
          )
        }

        rosterEntry = data
      }

      // ============================================================
      // STEP 1.5: Use the roster's canonical name for the users row
      // ============================================================

      const rosterName = (rosterEntry.full_name || '').trim()
      const canonicalName = rosterName || fullName.trim().toUpperCase()

      if (rosterName && rosterName !== fullName) {
        setFullName(rosterName)
      }

      // ============================================================
      // STEP 2: Create the auth account
      // ============================================================

      const { data: authData, error: authError } =
        await supabase.auth.signUp({
          email: cleanEmail,
          password,
        })

      if (authError) throw authError

      if (!authData.user) {
        throw new Error('Registration failed. No user was created.')
      }

      const userId = authData.user.id

      // ============================================================
      // STEP 3: Create the public.users row (canonical name)
      // ============================================================

      const { error: userError } = await supabase
        .from('users')
        .insert({
          id: userId,
          full_name: canonicalName,
          email: cleanEmail,
          role,
        })

      if (userError) throw userError

      // ============================================================
      // STEP 4: Create the role-specific row + link roster
      // ============================================================

      if (role === 'student') {
        const { error: studentError } = await supabase
          .from('students')
          .insert({
            id: userId,
            sr_code: rosterEntry.sr_code,
            course: rosterEntry.course || null,
          })

        if (studentError) throw studentError

        // Link the students_roster row via SECURITY DEFINER RPC.
        // Direct UPDATE would be blocked by RLS — students have no
        // UPDATE policy on students_roster. The RPC runs elevated
        // and matches the row by sr_code (already verified in Step 1).
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

        // Link the faculty_roster row via SECURITY DEFINER RPC.
        // Matches by email (unique in faculty_roster).
        const { error: linkError } = await supabase.rpc(
          'claim_faculty_roster',
          {
            p_user_id: userId,
            p_email: cleanEmail,
          }
        )

        if (linkError) throw linkError
      }

      // ============================================================
      // DONE
      // ============================================================

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
      console.error('Registration error:', error)
      setErrorMsg(
        error?.message || 'Something went wrong during registration.'
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.formContainer}>

        <Text style={styles.title}>Create Account</Text>

        <Text style={styles.subtitle}>
          Register your UniNav account
        </Text>

        {errorMsg ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{errorMsg}</Text>
          </View>
        ) : null}

        {notice ? (
          <View
            style={[
              styles.noticeBox,
              notice.type === 'success' && styles.noticeSuccess,
            ]}
          >
            <Text style={styles.noticeText}>{notice.message}</Text>
          </View>
        ) : null}

        {/* Full Name */}
        <View style={styles.inputContainer}>
          <Text style={styles.inputLabel}>Full Name</Text>
          <TextInput
            style={styles.input}
            placeholder="SURNAME, FIRST NAME M."
            placeholderTextColor={COLORS.gray}
            value={fullName}
            onChangeText={(t) => setFullName(t.toUpperCase())}
            autoCapitalize="characters"
          />
          <Text style={styles.helperText}>
            Must match your record in the {role === 'student' ? 'student' : 'faculty'} roster.
          </Text>
        </View>

        {/* Email */}
        <View style={styles.inputContainer}>
          <Text style={styles.inputLabel}>Email</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. name@batstate-u.edu.ph"
            placeholderTextColor={COLORS.gray}
            value={email}
            onChangeText={(t) => setEmail(t.toLowerCase())}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>

        {/* Role */}
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
                setErrorMsg('')
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
                setErrorMsg('')
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

        {/* Student SR Code */}
        {role === 'student' && (
          <View style={styles.inputContainer}>
            <Text style={styles.inputLabel}>SR Code</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. 2023-00123"
              placeholderTextColor={COLORS.gray}
              value={srCode}
              onChangeText={setSrCode}
              autoCapitalize="characters"
            />
            <Text style={styles.helperText}>
              Must match your record in the student roster.
            </Text>
          </View>
        )}

        {/* Password */}
        <View style={styles.inputContainer}>
          <Text style={styles.inputLabel}>Password</Text>
          <TextInput
            style={styles.input}
            placeholder="At least 6 characters"
            placeholderTextColor={COLORS.gray}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />
        </View>

        {/* Confirm Password */}
        <View style={styles.inputContainer}>
          <Text style={styles.inputLabel}>Confirm Password</Text>
          <TextInput
            style={styles.input}
            placeholder="Re-enter your password"
            placeholderTextColor={COLORS.gray}
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            secureTextEntry
          />
        </View>

        {/* Register Button */}
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

        {/* Login */}
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
  errorBox: {
    backgroundColor: '#FDECEC',
    borderWidth: 1,
    borderColor: '#F5B5B5',
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
  },
  errorText: {
    color: COLORS.error,
    fontSize: 13,
  },
  noticeBox: {
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
  },
  noticeSuccess: {
    backgroundColor: '#EAF6EC',
    borderWidth: 1,
    borderColor: COLORS.success,
  },
  noticeText: {
    color: COLORS.black,
    fontSize: 13,
  },
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