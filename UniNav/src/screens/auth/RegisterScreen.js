import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
  Alert 
} from 'react-native'
import { useState } from 'react'
import { supabase } from '../../services/supabase'
import { StatusBar } from 'expo-status-bar'
import { COLORS, FONTS, SIZES } from '../../constants/theme'
import { Ionicons } from '@expo/vector-icons';

const RegisterScreen = ({ navigation }) => {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [role, setRole] = useState('student'); // 'student' | 'faculty'
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [notice, setNotice] = useState(null);

  // Student-only fields
  const [srCode, setSrCode] = useState('');
  const [course, setCourse] = useState('');
  const [section, setSection] = useState('');

  // Faculty-only fields
  const [employeeId, setEmployeeId] = useState('');
  const [department, setDepartment] = useState('');

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const handleRegister = async () => {
    setErrorMsg('');

    if (!fullName || !email || !password || !confirmPassword) {
      setErrorMsg('Please fill in all required fields.');
      return;
    }
    if (password !== confirmPassword) {
      setErrorMsg('Passwords do not match.');
      return;
    }
    if (role === 'student' && (!srCode || !course || !section)) {
      setErrorMsg('Please fill in all student details.');
      return;
    }
    if (role === 'faculty' && (!employeeId || !department)) {
      setErrorMsg('Please fill in all faculty details.');
      return;
    }

    setLoading(true);

    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password,
    });

    if (authError) {
      setLoading(false);
      if (
        authError.message.toLowerCase().includes('already registered') ||
        authError.message.toLowerCase().includes('already exists') ||
        authError.code === 'user_already_exists'
      ) {
        setNotice({ type: 'warning', message: 'This email already has an account. Try logging in instead.' });
      } else {
        setNotice({ type: 'error', message: authError.message });
      }
      return;
    }

    const userId = authData.user.id;

    const { error: userError } = await supabase.from('users').insert({
      id: userId,
      full_name: fullName,
      email,
      role: role === 'student' ? 'student' : 'professor',
    });

    if (userError) {
      setLoading(false);
      setNotice({ type: 'error', message: 'Account created but profile failed: ' + userError.message });
      return;
    }

    const roleInsert =
      role === 'student'
        ? supabase.from('students').insert({
            id: userId,
            sr_code: srCode,
            course,
            section,
          })
        : supabase.from('faculty').insert({
            id: userId,
            employee_id: employeeId,
            department,
          });

    const { error: roleError } = await roleInsert;

    setLoading(false);

    if (roleError) {
      setNotice({ type: 'error', message: 'Profile incomplete: ' + roleError.message });
      return;
    }

    // Success!
    setNotice({ type: 'success', message: 'Your account has been created!' });
    setTimeout(() => navigation.navigate('Login'), 1500);

  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 60}
    >
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={styles.scrollContainer}>

        <View style={styles.header}>
          <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
            <Text style={styles.backText}>← Back</Text>
          </TouchableOpacity>
          <Text style={styles.appName}>UniNav</Text>
          <Text style={styles.headerSubtitle}>Create your account</Text>
        </View>

        <View style={styles.form}>

          {errorMsg ? <Text style={styles.errorText}>{errorMsg}</Text> : null}

          <View style={styles.inputContainer}>
            <Text style={styles.inputLabel}>Full Name</Text>
            <TextInput
              style={styles.input}
              placeholder="Enter your full name"
              placeholderTextColor={COLORS.gray}
              value={fullName}
              onChangeText={setFullName}
            />
          </View>

          <View style={styles.inputContainer}>
            <Text style={styles.inputLabel}>Email</Text>
            <TextInput
              style={styles.input}
              placeholder="Enter your email"
              placeholderTextColor={COLORS.gray}
              keyboardType="email-address"
              autoCapitalize="none"
              value={email}
              onChangeText={setEmail}
            />
          </View>

           {/* Password */}
          <View style={styles.inputContainer}>
            <Text style={styles.inputLabel}>Password</Text>
            <View style={styles.passwordRow}>
              <TextInput
                style={styles.passwordInput}
                placeholder="Enter your password"
                placeholderTextColor={COLORS.gray}
                secureTextEntry={!showPassword}
                value={password}
                onChangeText={setPassword}
              />
              <TouchableOpacity
                onPress={() => setShowPassword(!showPassword)}
                style={styles.eyeIcon}
              >
                <Ionicons
                  name={showPassword ? 'eye-off' : 'eye'}
                  size={20}
                  color={COLORS.gray}
                />
              </TouchableOpacity>
            </View>
          </View>

          {/* Confirm Password */}
          <View style={styles.inputContainer}>
            <Text style={styles.inputLabel}>Confirm Password</Text>
            <View style={styles.passwordRow}>
              <TextInput
                style={styles.passwordInput}
                placeholder="Confirm your password"
                placeholderTextColor={COLORS.gray}
                secureTextEntry={!showConfirmPassword}
                value={confirmPassword}
                onChangeText={setConfirmPassword}
              />
              <TouchableOpacity
                onPress={() => setShowConfirmPassword(!showConfirmPassword)}
                style={styles.eyeIcon}
              >
                <Ionicons
                  name={showConfirmPassword ? 'eye-off' : 'eye'}
                  size={20}
                  color={COLORS.gray}
                />
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.inputContainer}>
            <Text style={styles.inputLabel}>Role</Text>
            <View style={styles.roleContainer}>
              {[
                { label: 'Student', value: 'student' },
                { label: 'Faculty', value: 'faculty' },
              ].map((r) => (
                <TouchableOpacity
                  key={r.value}
                  style={[
                    styles.roleButton,
                    role === r.value && styles.roleButtonActive,
                  ]}
                  onPress={() => setRole(r.value)}
                >
                  <Text
                    style={[
                      styles.roleText,
                      role === r.value && styles.roleTextActive,
                    ]}
                  >
                    {r.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {role === 'student' && (
            <>
              <View style={styles.inputContainer}>
                <Text style={styles.inputLabel}>SR Code</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. 22-75347"
                  placeholderTextColor={COLORS.gray}
                  value={srCode}
                  onChangeText={setSrCode}
                />
              </View>

              <View style={styles.inputContainer}>
                <Text style={styles.inputLabel}>Course</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. BSIT"
                  placeholderTextColor={COLORS.gray}
                  value={course}
                  onChangeText={setCourse}
                />
              </View>

              <View style={styles.inputContainer}>
                <Text style={styles.inputLabel}>Section</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. IT 1101"
                  placeholderTextColor={COLORS.gray}
                  value={section}
                  onChangeText={setSection}
                />
              </View>

              {notice && (
                <View style={[
                  styles.noticeBox,
                  notice.type === 'success' && styles.noticeSuccess,
                  notice.type === 'warning' && styles.noticeWarning,
                  notice.type === 'error' && styles.noticeError,
                ]}>
                  <Text style={styles.noticeText}>{notice.message}</Text>
                </View>
              )}
            </>
          )}

          {role === 'faculty' && (
            <>
              <View style={styles.inputContainer}>
                <Text style={styles.inputLabel}>Employee ID</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Enter your employee ID"
                  placeholderTextColor={COLORS.gray}
                  value={employeeId}
                  onChangeText={setEmployeeId}
                />
              </View>

              <View style={styles.inputContainer}>
                <Text style={styles.inputLabel}>Department</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. CICS"
                  placeholderTextColor={COLORS.gray}
                  value={department}
                  onChangeText={setDepartment}
                />
              </View>
            </>
          )}

          <TouchableOpacity
            style={styles.registerButton}
            onPress={handleRegister}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color={COLORS.white} />
            ) : (
              <Text style={styles.registerButtonText}>REGISTER</Text>
            )}
          </TouchableOpacity>

          <View style={styles.loginContainer}>
            <Text style={styles.loginText}>Already have an account? </Text>
            <TouchableOpacity onPress={() => navigation.navigate('Login')}>
              <Text style={styles.loginLink}>Login</Text>
            </TouchableOpacity>
          </View>

        </View>

      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.primary,
  },
  scrollContainer: {
    flexGrow: 1,
  },
  header: {
    paddingHorizontal: SIZES.padding,
    paddingTop: 60,
    paddingBottom: 30,
  },
  backButton: {
    marginBottom: 16,
  },
  backText: {
    color: COLORS.secondary,
    fontSize: FONTS.medium,
    fontWeight: 'bold',
  },
  appName: {
    fontSize: 36,
    fontWeight: 'bold',
    color: COLORS.white,
    letterSpacing: 4,
  },
  headerSubtitle: {
    fontSize: FONTS.medium,
    color: COLORS.lightGray,
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
  },
  // --- New: password field with eye toggle, same look as .input ---
  passwordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.background,
    borderRadius: SIZES.borderRadius,
    borderWidth: 1,
    borderColor: COLORS.lightGray,
    paddingHorizontal: 14,
  },
  passwordInput: {
    flex: 1,
    paddingVertical: 14,
    fontSize: FONTS.medium,
    color: COLORS.black,
  },
  eyeIcon: {
    padding: 4,
    marginLeft: 8,
  },
  roleContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 8,
  },
  roleButton: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: COLORS.background,
    borderRadius: SIZES.borderRadius,
    padding: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.lightGray,
  },
  // --- New: needed since RegisterScreen now highlights the selected role ---
  roleButtonActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  roleText: {
    fontSize: FONTS.medium,
    color: COLORS.black,
    fontWeight: '500',
  },
    roleTextActive: {
    color: COLORS.white,
  },
  // --- New: needed since RegisterScreen now shows validation/error messages ---
  errorText: {
    color: '#D32F2F',
    fontSize: FONTS.medium,
    marginBottom: 12,
    textAlign: 'center',
  },
  registerButton: {
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
  registerButtonText: {
    color: COLORS.white,
    fontSize: FONTS.medium,
    fontWeight: 'bold',
    letterSpacing: 2,
  },
  loginContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 20,
  },
  loginText: {
    color: COLORS.gray,
    fontSize: FONTS.medium,
  },
  loginLink: {
    color: COLORS.primary,
    fontSize: FONTS.medium,
    fontWeight: 'bold',
  },
  noticeBox: {
    borderRadius: SIZES.borderRadius,
    padding: 12,
    marginBottom: 16,
    borderWidth: 1,
  },
  noticeSuccess: {
    backgroundColor: '#EAF6EC',
    borderColor: '#2E8B22',
  },
  noticeWarning: {
    backgroundColor: '#FFF6E0',
    borderColor: '#B8860B',
  },
  noticeError: {
    backgroundColor: '#FDECEA',
    borderColor: '#B3261E',
  },
  noticeText: {
    fontSize: FONTS.medium,
    fontWeight: '500',
    color: COLORS.black,
  },
});

export default RegisterScreen