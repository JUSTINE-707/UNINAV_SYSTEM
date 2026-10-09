import { useCallback, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import { Feather } from '@expo/vector-icons'
import * as DocumentPicker from 'expo-document-picker'
import { File } from 'expo-file-system'
import Papa from 'papaparse'
import { supabase } from '../../services/supabase'
import { useAuth } from '../../context/AuthContext'
import { useSemester } from '../../context/SemesterContext'

const COLORS = {
  primary: '#8B0000',
  ink: '#18181B',
  muted: '#71717A',
  white: '#FFFFFF',
  green: '#166534',
  greenBackground: '#F0FDF4',
  red: '#9F1239',
  redBackground: '#FFF1F2',
  crimsonSoft: '#FCEBEC',
  subtle: '#A1A1AA',
}

const normalize = (value) => String(value || '').trim().toUpperCase()
const normalizeName = (value) => normalize(value).replace(/[^A-Z0-9]/g, '')
const sectionKey = (subject, section) => `${normalize(subject)}|${normalize(section)}`
const courseKey = (subject) => normalize(subject)
const ENROLLMENT_STEPS = [
  { key: 'courses', label: 'Courses' },
  { key: 'sections', label: 'Sections' },
  { key: 'students', label: 'Students' },
]

const EnrollmentImportScreen = ({ navigation }) => {
  const { user } = useAuth()
  const { semester } = useSemester()
  const [classes, setClasses] = useState([])
  const [step, setStep] = useState('courses')
  const [selectedCourseKey, setSelectedCourseKey] = useState('')
  const [selectedKey, setSelectedKey] = useState('')
  const [enrolledStudents, setEnrolledStudents] = useState([])
  const [loadingStudents, setLoadingStudents] = useState(false)
  const [studentsError, setStudentsError] = useState('')
  const [fileName, setFileName] = useState('')
  const [csvText, setCsvText] = useState('')
  const [loading, setLoading] = useState(true)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [rowErrors, setRowErrors] = useState([])
  const [searchQuery, setSearchQuery] = useState('')

  const selectedClass = useMemo(
    () => classes.find((item) => item.key === selectedKey) || null,
    [classes, selectedKey]
  )
  const courses = useMemo(() => {
    const grouped = new Map()
    classes.forEach((item) => {
      const key = courseKey(item.subject_code)
      if (!grouped.has(key)) {
        grouped.set(key, {
          key,
          subject_code: item.subject_code,
          course_title: item.course_title,
          sections: [],
        })
      }
      grouped.get(key).sections.push(item)
    })
    return Array.from(grouped.values()).sort((a, b) =>
      `${a.subject_code} ${a.course_title || ''}`.localeCompare(
        `${b.subject_code} ${b.course_title || ''}`
      )
    )
  }, [classes])
  const selectedCourse = useMemo(
    () => courses.find((item) => item.key === selectedCourseKey) || null,
    [courses, selectedCourseKey]
  )
  const filteredCourses = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    if (!query) return courses
    return courses.filter(
      (course) =>
        course.subject_code?.toLowerCase().includes(query) ||
        course.course_title?.toLowerCase().includes(query)
    )
  }, [courses, searchQuery])
  const filteredSections = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    const sections = selectedCourse?.sections || []
    if (!query) return sections
    return sections.filter((item) =>
      String(item.section || '').toLowerCase().includes(query)
    )
  }, [searchQuery, selectedCourse])
  const filteredStudents = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    if (!query) return enrolledStudents
    return enrolledStudents.filter(
      (student) =>
        student.full_name?.toLowerCase().includes(query) ||
        student.sr_code?.toLowerCase().includes(query) ||
        student.email?.toLowerCase().includes(query)
    )
  }, [enrolledStudents, searchQuery])

  const loadEnrolledStudents = async (classItem) => {
    if (!classItem || !semester?.id) return

    setLoadingStudents(true)
    setStudentsError('')
    try {
      const scheduleIds = classItem.meetings.map(({ id }) => id)
      if (!scheduleIds.length) {
        setEnrolledStudents([])
        return
      }

      const { data: enrollments, error: enrollmentError } = await supabase
        .from('enrollments')
        .select('student_id')
        .in('schedule_id', scheduleIds)

      if (enrollmentError) throw enrollmentError

      const studentIds = [
        ...new Set(
          (enrollments || [])
            .map(({ student_id }) => student_id)
            .filter(Boolean)
        ),
      ]
      if (!studentIds.length) {
        setEnrolledStudents([])
        return
      }

      const { data: students, error: studentsError } = await supabase
        .from('students_roster')
        .select('id, sr_code, full_name, email')
        .in('id', studentIds)

      if (studentsError) throw studentsError

      const studentsById = new Map(
        (students || []).map((student) => [student.id, student])
      )
      const missingStudents = studentIds.filter((id) => !studentsById.has(id))
      if (missingStudents.length) {
        throw new Error(
          `${missingStudents.length} enrolled student record(s) could not be found in the student roster.`
        )
      }

      setEnrolledStudents(
        Array.from(studentsById.values()).sort((a, b) =>
          (a.full_name || '').localeCompare(b.full_name || '')
        )
      )
    } catch (loadError) {
      console.error('Load section enrollments error:', loadError)
      setStudentsError(
        loadError.message || 'Failed to load enrolled students.'
      )
      setEnrolledStudents([])
    } finally {
      setLoadingStudents(false)
    }
  }

  useFocusEffect(
    useCallback(() => {
      let isActive = true

      const loadClasses = async () => {
        setLoading(true)
        setClasses([])
        setStep('courses')
        setSelectedCourseKey('')
        setSelectedKey('')
        setEnrolledStudents([])
        setStudentsError('')
        setError('')
        setMessage('')
        setRowErrors([])

        try {
          if (!user?.id) throw new Error('Your account could not be verified.')
          if (!semester?.id) throw new Error('There is no active semester.')

          const [facultyRes, userRes] = await Promise.all([
            supabase
              .from('faculty')
              .select('employee_id, program')
              .eq('id', user.id)
              .maybeSingle(),
            supabase
              .from('users')
              .select('full_name')
              .eq('id', user.id)
              .maybeSingle(),
          ])

          if (facultyRes.error) throw facultyRes.error
          if (userRes.error) throw userRes.error
          if (!facultyRes.data) {
            throw new Error('Your faculty profile was not found.')
          }

          const columns =
            'id, subject_code, course_title, section, day, start_time, end_time, professor_name, professor_id, employee_id'
          let schedules = []

          const byProfessor = await supabase
            .from('schedules')
            .select(columns)
            .eq('professor_id', user.id)
            .eq('semester_id', semester.id)
          if (byProfessor.error) throw byProfessor.error
          schedules = byProfessor.data || []

          if (!schedules.length && facultyRes.data.employee_id) {
            const byEmployee = await supabase
              .from('schedules')
              .select(columns)
              .eq('employee_id', facultyRes.data.employee_id)
              .eq('semester_id', semester.id)
            if (byEmployee.error) throw byEmployee.error
            schedules = byEmployee.data || []
          }

          if (
            !schedules.length &&
            facultyRes.data.program &&
            userRes.data?.full_name
          ) {
            const candidates = await supabase
              .from('schedules')
              .select(columns)
              .eq('program', facultyRes.data.program)
              .eq('semester_id', semester.id)
            if (candidates.error) throw candidates.error

            const professorName = normalizeName(userRes.data.full_name)
            schedules = (candidates.data || []).filter(
              (schedule) =>
                normalizeName(schedule.professor_name) === professorName
            )
          }

          const grouped = new Map()
          schedules.forEach((schedule) => {
            const key = sectionKey(schedule.subject_code, schedule.section)
            if (!grouped.has(key)) {
              grouped.set(key, {
                key,
                subject_code: schedule.subject_code,
                course_title: schedule.course_title,
                section: schedule.section,
                meetings: [],
              })
            }
            grouped.get(key).meetings.push(schedule)
          })

          const classList = Array.from(grouped.values()).sort((a, b) =>
            `${a.subject_code} ${a.section}`.localeCompare(
              `${b.subject_code} ${b.section}`
            )
          )

          if (isActive) {
            setClasses(classList)
          }
        } catch (loadError) {
          console.error('Load enrollment classes error:', loadError)
          if (isActive) setError(loadError.message || 'Failed to load classes.')
        } finally {
          if (isActive) setLoading(false)
        }
      }

      loadClasses()
      return () => {
        isActive = false
      }
    }, [user?.id, semester?.id])
  )

  const chooseFile = async () => {
    setError('')
    setMessage('')
    setRowErrors([])

    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['text/csv', 'application/vnd.ms-excel'],
        copyToCacheDirectory: true,
      })
      if (result.canceled) return

      const asset = result.assets[0]
      if (!asset.name.toLowerCase().endsWith('.csv')) {
        throw new Error('Please choose a .csv file.')
      }

      const contents = asset.file
        ? await asset.file.text()
        : await new File(asset.uri).text()
      if (!contents.trim()) throw new Error('The selected CSV file is empty.')

      setFileName(asset.name)
      setCsvText(contents)
      setMessage('CSV file ready. Review the selected class, then import.')
    } catch (pickError) {
      console.error('Choose enrollment CSV error:', pickError)
      setError(pickError.message || 'Could not read the selected CSV file.')
    }
  }

  const importCsv = async () => {
    if (!selectedClass || !semester?.id) {
      setError('Select one of your classes before importing.')
      return
    }
    if (!csvText) {
      setError('Choose a CSV file first.')
      return
    }

    setImporting(true)
    setError('')
    setMessage('')
    setRowErrors([])

    try {
      const parsed = Papa.parse(csvText, {
        header: true,
        skipEmptyLines: 'greedy',
        transformHeader: (header) =>
          header.replace(/^\uFEFF/, '').trim().toUpperCase(),
        transform: (value) => value.trim(),
      })

      if (parsed.errors.length) {
        throw new Error(`CSV parsing failed: ${parsed.errors[0].message}`)
      }

      const requiredHeaders = ['SR_CODE', 'SUBJECT_CODE', 'SECTION']
      const headers = parsed.meta.fields || []
      const missingHeaders = requiredHeaders.filter(
        (header) => !headers.includes(header)
      )
      if (missingHeaders.length) {
        throw new Error(
          `CSV must include these columns: ${requiredHeaders.join(', ')}.`
        )
      }
      if (!parsed.data.length) throw new Error('The CSV contains no student rows.')

      const errors = []
      const rows = []
      const seenStudents = new Set()
      let duplicateRowCount = 0

      parsed.data.forEach((row, index) => {
        const rowNumber = index + 2
        const srCode = (row.SR_CODE || '').trim()
        const subject = (row.SUBJECT_CODE || '').trim()
        const section = (row.SECTION || '').trim()

        if (!srCode || !subject || !section) {
          errors.push({
            row: rowNumber,
            message: 'Missing SR_CODE, SUBJECT_CODE, or SECTION.',
          })
          return
        }
        if (
          sectionKey(subject, section) !==
          sectionKey(selectedClass.subject_code, selectedClass.section)
        ) {
          errors.push({
            row: rowNumber,
            message: `This row is for ${subject} - ${section}, not the selected class.`,
          })
          return
        }

        const studentKey = normalize(srCode)
        if (seenStudents.has(studentKey)) {
          duplicateRowCount += 1
          return
        }
        seenStudents.add(studentKey)
        rows.push({ srCode, rowNumber })
      })

      if (errors.length) {
        setRowErrors(errors)
        throw new Error(
          `${errors.length} row(s) need correction. Nothing was imported.`
        )
      }
      if (!rows.length) throw new Error('The CSV contains no student rows.')

      const scheduleIds = selectedClass.meetings.map((meeting) => meeting.id)
      const [rosterRes, enrollmentRes] = await Promise.all([
        supabase
          .from('students_roster')
          .select('id, sr_code, full_name')
          .in('sr_code', [...new Set(rows.map((row) => row.srCode))]),
        supabase
          .from('enrollments')
          .select('student_id, schedule_id')
          .in('schedule_id', scheduleIds),
      ])

      if (rosterRes.error) throw rosterRes.error
      if (enrollmentRes.error) throw enrollmentRes.error

      const studentsByCode = new Map(
        (rosterRes.data || []).map((student) => [
          normalize(student.sr_code),
          student,
        ])
      )
      const existing = new Set(
        (enrollmentRes.data || []).map(
          (enrollment) => `${enrollment.student_id}|${enrollment.schedule_id}`
        )
      )
      const insertRows = []
      const missingStudents = []
      let duplicateCount = 0

      rows.forEach(({ srCode, rowNumber }) => {
        const student = studentsByCode.get(normalize(srCode))
        if (!student) {
          missingStudents.push({
            row: rowNumber,
            message: `Student not found in the roster: ${srCode}.`,
          })
          return
        }

        selectedClass.meetings.forEach((meeting) => {
          const pair = `${student.id}|${meeting.id}`
          if (existing.has(pair)) {
            duplicateCount += 1
            return
          }
          existing.add(pair)
          insertRows.push({
            student_id: student.id,
            schedule_id: meeting.id,
            semester_id: semester.id,
          })
        })
      })

      if (missingStudents.length) {
        setRowErrors(missingStudents)
        throw new Error(
          `${missingStudents.length} student(s) are missing from the roster. Nothing was imported.`
        )
      }

      if (!insertRows.length) {
        setMessage(
          `No new enrollments. All students are already enrolled in ${selectedClass.subject_code} - ${selectedClass.section}.`
        )
        return
      }

      const { error: insertError } = await supabase
        .from('enrollments')
        .insert(insertRows)
      if (insertError) throw insertError

      setMessage(
        `Added ${insertRows.length} enrollment record(s) for ${new Set(
          insertRows.map((row) => row.student_id)
        ).size} student(s) in ${selectedClass.subject_code} - ${selectedClass.section}.` +
          (duplicateCount || duplicateRowCount
            ? ` Skipped ${duplicateCount} existing meeting enrollment(s) and ${duplicateRowCount} repeated CSV row(s).`
            : '')
      )
      await loadEnrolledStudents(selectedClass)
      setFileName('')
      setCsvText('')
    } catch (importError) {
      console.error('Enrollment import error:', importError)
      setError(importError.message || 'Enrollment import failed.')
    } finally {
      setImporting(false)
    }
  }

  const goBack = () => {
    setSearchQuery('')
    if (step === 'students') {
      setStep('sections')
      return
    }
    if (step === 'sections') {
      setStep('courses')
      return
    }
    navigation.goBack()
  }

  const openCourse = (course) => {
    setSelectedCourseKey(course.key)
    setSearchQuery('')
    setStep('sections')
  }

  const openSection = async (classItem) => {
    setSelectedKey(classItem.key)
    setEnrolledStudents([])
    setStudentsError('')
    setFileName('')
    setCsvText('')
    setError('')
    setMessage('')
    setRowErrors([])
    setSearchQuery('')
    setStep('students')
    await loadEnrolledStudents(classItem)
  }

  const navigateToStep = (targetStep) => {
    const currentIndex = ENROLLMENT_STEPS.findIndex(({ key }) => key === step)
    const targetIndex = ENROLLMENT_STEPS.findIndex(
      ({ key }) => key === targetStep
    )

    if (targetIndex < 0 || targetIndex >= currentIndex) return
    setSearchQuery('')
    setStep(targetStep)
  }

  const currentStepIndex = ENROLLMENT_STEPS.findIndex(
    ({ key }) => key === step
  )

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={step === 'courses' ? 'Go back' : 'Back to previous list'}
          onPress={goBack}
          style={styles.backButton}
        >
          <Feather name="arrow-left" size={20} color={COLORS.ink} />
        </TouchableOpacity>
        <View>
          <Text style={styles.headerTitle}>
            {step === 'courses'
              ? 'My Courses'
              : step === 'sections'
                ? 'Sections'
                : `${selectedClass?.subject_code || 'Class'} · ${selectedClass?.section || ''}`}
          </Text>
          <Text style={styles.headerSubtitle}>
            {step === 'courses'
              ? `${semester?.name || 'Current semester'} · Courses you teach`
              : semester?.name || 'Current semester'}
          </Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {loading ? (
          <View style={styles.loadingState}>
            <ActivityIndicator color={COLORS.primary} size="large" />
            <Text style={styles.loadingText}>Loading your classes…</Text>
          </View>
        ) : error && !classes.length ? (
          <View style={styles.emptyState}>
            <View style={styles.emptyIcon}>
              <Feather name="alert-circle" size={24} color={COLORS.red} />
            </View>
            <Text style={styles.emptyTitle}>Couldn’t load classes</Text>
            <Text style={styles.emptyDescription}>{error}</Text>
          </View>
        ) : !classes.length ? (
          <View style={styles.emptyState}>
            <View style={styles.emptyIcon}>
              <Feather name="book-open" size={24} color={COLORS.primary} />
            </View>
            <Text style={styles.emptyTitle}>No classes yet</Text>
            <Text style={styles.emptyDescription}>
              No classes were found for your account in this semester.
            </Text>
          </View>
        ) : (
          <>
            <View style={styles.stepper}>
              <View style={styles.stepperTrack}>
                {ENROLLMENT_STEPS.map((item, index) => (
                  <View
                    key={item.key}
                    style={[
                      styles.stepperSegment,
                      index <= currentStepIndex && styles.stepperSegmentActive,
                    ]}
                  />
                ))}
              </View>
              <View style={styles.stepperSteps}>
                {ENROLLMENT_STEPS.map((item, index) => {
                  const isCurrent = item.key === step
                  const isComplete = index < currentStepIndex

                  return (
                    <TouchableOpacity
                      key={item.key}
                      accessibilityRole="button"
                      accessibilityLabel={`Step ${index + 1}: ${item.label}${
                        isComplete ? ', completed. Go back to this step.' : ''
                      }${isCurrent ? ', current step.' : ''}`}
                      accessibilityState={{
                        selected: isCurrent,
                        disabled: !isComplete,
                      }}
                      disabled={!isComplete}
                      onPress={() => navigateToStep(item.key)}
                      activeOpacity={0.75}
                      style={[
                        styles.stepButton,
                        isCurrent && styles.stepButtonCurrent,
                        !isComplete && !isCurrent && styles.stepButtonUpcoming,
                      ]}
                    >
                      <View
                        style={[
                          styles.stepNumber,
                          (isCurrent || isComplete) && styles.stepNumberActive,
                        ]}
                      >
                        {isComplete ? (
                          <Feather
                            name="check"
                            size={12}
                            color={COLORS.white}
                          />
                        ) : (
                          <Text
                            style={[
                              styles.stepNumberText,
                              isCurrent && styles.stepNumberTextActive,
                            ]}
                          >
                            {index + 1}
                          </Text>
                        )}
                      </View>
                      <Text
                        style={[
                          styles.stepLabel,
                          (isCurrent || isComplete) && styles.stepLabelActive,
                        ]}
                      >
                        {item.label}
                      </Text>
                    </TouchableOpacity>
                  )
                })}
              </View>
            </View>

            <View style={styles.listHeading}>
              <View style={styles.listHeadingDetails}>
                <Text style={styles.listTitle}>
                  {step === 'courses'
                    ? 'Your courses'
                    : step === 'sections'
                      ? 'Choose a section'
                      : 'Enrolled students'}
                </Text>
                <Text style={styles.listSubtitle}>
                  {step === 'courses'
                    ? 'Choose a course to view its sections.'
                    : step === 'sections'
                      ? `${selectedCourse?.course_title ? `${selectedCourse.course_title} · ` : ''}${selectedCourse?.subject_code || 'Selected course'}`
                      : `${selectedClass?.subject_code} · ${selectedClass?.section}`}
                </Text>
              </View>
              <View
                style={styles.countBadge}
                accessibilityLabel={`${step === 'courses' ? filteredCourses.length : step === 'sections' ? filteredSections.length : filteredStudents.length} ${
                  step === 'courses'
                    ? 'courses'
                    : step === 'sections'
                      ? 'sections'
                      : 'students'
                }`}
              >
                <Text style={styles.countText}>
                  {step === 'courses'
                    ? filteredCourses.length
                    : step === 'sections'
                      ? filteredSections.length
                      : filteredStudents.length}
                </Text>
              </View>
            </View>

            <View style={styles.searchField}>
              <Feather name="search" size={17} color={COLORS.muted} />
              <TextInput
                accessibilityLabel={
                  step === 'courses'
                    ? 'Search courses'
                    : step === 'sections'
                      ? 'Search sections'
                      : 'Search enrolled students'
                }
                placeholder={
                  step === 'courses'
                    ? 'Search courses'
                    : step === 'sections'
                      ? 'Search sections'
                      : 'Search by name or SR code'
                }
                placeholderTextColor={COLORS.subtle}
                value={searchQuery}
                onChangeText={setSearchQuery}
                style={styles.searchInput}
                returnKeyType="search"
                autoCapitalize="none"
              />
              {!!searchQuery && (
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel="Clear search"
                  onPress={() => setSearchQuery('')}
                  hitSlop={10}
                >
                  <Feather name="x-circle" size={17} color={COLORS.muted} />
                </TouchableOpacity>
              )}
            </View>

            {step === 'courses' ? (
              filteredCourses.length ? (
                filteredCourses.map((course) => (
                  <TouchableOpacity
                    key={course.key}
                    accessibilityRole="button"
                    onPress={() => openCourse(course)}
                    activeOpacity={0.78}
                    style={styles.courseCard}
                  >
                    <View style={styles.courseIcon}>
                      <Feather name="book-open" size={19} color={COLORS.primary} />
                    </View>
                    <View style={styles.cardDetails}>
                      <Text style={styles.courseCode}>{course.subject_code}</Text>
                      {!!course.course_title && (
                        <Text style={styles.cardSubtitle} numberOfLines={2}>
                          {course.course_title}
                        </Text>
                      )}
                    </View>
                    <View style={styles.cardTrailing}>
                      <Text style={styles.sectionCount}>
                        {course.sections.length}{' '}
                        {course.sections.length === 1 ? 'section' : 'sections'}
                      </Text>
                      <Feather name="chevron-right" size={20} color={COLORS.subtle} />
                    </View>
                  </TouchableOpacity>
                ))
              ) : (
                <EmptySearch label="No courses match your search." />
              )
            ) : step === 'sections' ? (
              filteredSections.length ? (
                filteredSections.map((item) => (
                  <TouchableOpacity
                    key={item.key}
                    accessibilityRole="button"
                    onPress={() => openSection(item)}
                    activeOpacity={0.78}
                    style={styles.sectionCard}
                  >
                    <View style={styles.sectionMark}>
                      <Text style={styles.sectionMarkText}>
                        {item.section?.slice(0, 2) || '—'}
                      </Text>
                    </View>
                    <View style={styles.cardDetails}>
                      <Text style={styles.courseCode}>{item.section}</Text>
                      <Text style={styles.cardSubtitle}>
                        {item.meetings.length}{' '}
                        {item.meetings.length === 1 ? 'class meeting' : 'class meetings'}
                      </Text>
                    </View>
                    <Feather name="chevron-right" size={20} color={COLORS.subtle} />
                  </TouchableOpacity>
                ))
              ) : (
                <EmptySearch label="No sections match your search." />
              )
            ) : (
              <>
                <View style={styles.importCard}>
                  <View style={styles.importCardHeading}>
                    <View style={styles.importIcon}>
                      <Feather name="upload-cloud" size={19} color={COLORS.primary} />
                    </View>
                    <View style={styles.cardDetails}>
                      <Text style={styles.importTitle}>Import student list</Text>
                      <Text style={styles.cardSubtitle}>
                        CSV columns: SR_CODE, SUBJECT_CODE, SECTION
                      </Text>
                    </View>
                  </View>
                  <TouchableOpacity
                    accessibilityRole="button"
                    onPress={chooseFile}
                    disabled={loadingStudents || importing}
                    activeOpacity={0.78}
                    style={[
                      styles.fileButton,
                      (loadingStudents || importing) && styles.disabledButton,
                    ]}
                  >
                    <Feather
                      name={fileName ? 'refresh-cw' : 'upload'}
                      size={16}
                      color={COLORS.primary}
                    />
                    <Text style={styles.fileButtonText}>
                      {fileName ? 'Choose another CSV' : 'Choose CSV file'}
                    </Text>
                  </TouchableOpacity>
                  {!!fileName && (
                    <View style={styles.fileChip}>
                      <Feather name="file-text" size={15} color={COLORS.green} />
                      <Text style={styles.fileName} numberOfLines={1}>
                        {fileName}
                      </Text>
                      <Feather name="check-circle" size={15} color={COLORS.green} />
                    </View>
                  )}
                  <TouchableOpacity
                    accessibilityRole="button"
                    onPress={importCsv}
                    disabled={!csvText || !selectedClass || importing || loadingStudents}
                    activeOpacity={0.8}
                    style={[
                      styles.importButton,
                      (!csvText || !selectedClass || importing || loadingStudents) &&
                        styles.disabledButton,
                    ]}
                  >
                    {importing ? (
                      <ActivityIndicator color={COLORS.white} />
                    ) : (
                      <>
                        <Text style={styles.importButtonText}>Import students</Text>
                        <Feather name="arrow-right" size={17} color={COLORS.white} />
                      </>
                    )}
                  </TouchableOpacity>
                </View>

                {loadingStudents ? (
                  <View style={styles.loadingRoster}>
                    <ActivityIndicator color={COLORS.primary} />
                    <Text style={styles.loadingText}>Loading student roster…</Text>
                  </View>
                ) : studentsError ? (
                  <View style={styles.errorBox}>
                    <Text style={styles.errorText}>{studentsError}</Text>
                  </View>
                ) : filteredStudents.length ? (
                  <View style={styles.studentList}>
                    {filteredStudents.map((student, index) => (
                      <View
                        key={student.id}
                        style={[
                          styles.studentCard,
                          index === filteredStudents.length - 1 &&
                            styles.studentCardLast,
                        ]}
                      >
                        <View style={styles.studentAvatar}>
                          <Text style={styles.studentInitials}>
                            {(student.full_name || '?')
                              .split(/\s+/)
                              .filter(Boolean)
                              .slice(0, 2)
                              .map((part) => part[0])
                              .join('')
                              .toUpperCase()}
                          </Text>
                        </View>
                        <View style={styles.cardDetails}>
                          <Text style={styles.studentName} numberOfLines={1}>
                            {student.full_name || 'Unnamed student'}
                          </Text>
                          <Text style={styles.studentCode}>
                            {student.sr_code || 'No SR code'}
                          </Text>
                        </View>
                        <Feather
                          name="check-circle"
                          size={17}
                          color={COLORS.green}
                        />
                      </View>
                    ))}
                  </View>
                ) : enrolledStudents.length ? (
                  <EmptySearch label="No students match your search." />
                ) : (
                  <View style={styles.emptyState}>
                    <View style={styles.emptyIcon}>
                      <Feather name="users" size={24} color={COLORS.primary} />
                    </View>
                    <Text style={styles.emptyTitle}>No students enrolled</Text>
                    <Text style={styles.emptyDescription}>
                      Choose the class list CSV above to add students to this section.
                    </Text>
                  </View>
                )}
              </>
            )}
          </>
        )}

        {!!error && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}
        {!!message && (
          <View style={styles.messageBox}>
            <Text style={styles.messageText}>{message}</Text>
          </View>
        )}
        {!!rowErrors.length && (
          <View style={styles.rowErrors}>
            {rowErrors.slice(0, 8).map((item, index) => (
              <Text key={`${item.row}-${index}`} style={styles.errorText}>
                Row {item.row}: {item.message}
              </Text>
            ))}
            {rowErrors.length > 8 && (
              <Text style={styles.errorText}>
                And {rowErrors.length - 8} more row error(s).
              </Text>
            )}
          </View>
        )}
      </ScrollView>
    </View>
  )
}

const EmptySearch = ({ label }) => (
  <View style={styles.searchEmpty}>
    <Feather name="search" size={20} color={COLORS.subtle} />
    <Text style={styles.searchEmptyText}>{label}</Text>
  </View>
)

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F7F7F9' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.white,
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#ECECF0',
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 14,
    backgroundColor: '#F5F5F7',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  headerTitle: { color: COLORS.ink, fontSize: 18, fontWeight: '800' },
  headerSubtitle: { color: COLORS.muted, fontSize: 12, marginTop: 3 },
  content: { paddingHorizontal: 18, paddingTop: 22, paddingBottom: 40 },
  stepper: {
    backgroundColor: COLORS.white,
    borderColor: '#ECECF0',
    borderWidth: 1,
    borderRadius: 16,
    padding: 12,
    marginBottom: 20,
  },
  stepperTrack: { flexDirection: 'row', gap: 5, marginBottom: 9 },
  stepperSegment: {
    flex: 1,
    height: 3,
    borderRadius: 2,
    backgroundColor: '#E9E9EE',
  },
  stepperSegmentActive: { backgroundColor: COLORS.primary },
  stepperSteps: { flexDirection: 'row', gap: 5 },
  stepButton: {
    flex: 1,
    minWidth: 0,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    borderRadius: 10,
    paddingHorizontal: 4,
  },
  stepButtonCurrent: { backgroundColor: COLORS.crimsonSoft },
  stepButtonUpcoming: { opacity: 0.62 },
  stepNumber: {
    width: 21,
    height: 21,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F1F1F3',
  },
  stepNumberActive: { backgroundColor: COLORS.primary },
  stepNumberText: { color: COLORS.muted, fontSize: 11, fontWeight: '700' },
  stepNumberTextActive: { color: COLORS.white },
  stepLabel: { color: COLORS.muted, fontSize: 11, fontWeight: '600' },
  stepLabelActive: { color: COLORS.primary, fontWeight: '800' },
  listHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 15,
  },
  listHeadingDetails: { flex: 1, minWidth: 0, paddingRight: 12 },
  listTitle: { color: COLORS.ink, fontSize: 21, fontWeight: '800', letterSpacing: -0.4 },
  listSubtitle: { color: COLORS.muted, fontSize: 13, marginTop: 4 },
  countBadge: {
    minWidth: 36,
    height: 36,
    borderRadius: 18,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.crimsonSoft,
  },
  countText: { color: COLORS.primary, fontSize: 14, fontWeight: '800' },
  searchField: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: '#E9E9EE',
    borderRadius: 14,
    paddingHorizontal: 14,
    marginBottom: 14,
  },
  searchInput: {
    flex: 1,
    color: COLORS.ink,
    fontSize: 14,
    paddingVertical: 10,
    paddingHorizontal: 10,
  },
  courseCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.white,
    borderColor: '#ECECF0',
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
    minHeight: 82,
    shadowColor: '#18181B',
    shadowOpacity: 0.035,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 1,
  },
  courseIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.crimsonSoft,
    marginRight: 13,
  },
  cardDetails: { flex: 1, minWidth: 0 },
  courseCode: { color: COLORS.ink, fontSize: 15, fontWeight: '700' },
  cardSubtitle: { color: COLORS.muted, fontSize: 12, lineHeight: 17, marginTop: 4 },
  cardTrailing: { alignItems: 'flex-end', marginLeft: 8, gap: 4 },
  sectionCount: { color: COLORS.muted, fontSize: 11, fontWeight: '600' },
  sectionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.white,
    borderColor: '#ECECF0',
    borderWidth: 1,
    borderRadius: 16,
    padding: 15,
    marginBottom: 10,
    minHeight: 76,
    shadowColor: '#18181B',
    shadowOpacity: 0.035,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 1,
  },
  sectionMark: {
    minWidth: 44,
    height: 42,
    paddingHorizontal: 8,
    borderRadius: 13,
    backgroundColor: COLORS.crimsonSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 13,
  },
  sectionMarkText: { color: COLORS.primary, fontSize: 13, fontWeight: '800' },
  studentList: {
    backgroundColor: COLORS.white,
    borderColor: '#ECECF0',
    borderWidth: 1,
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 14,
  },
  studentCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 66,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F3',
  },
  studentCardLast: { borderBottomWidth: 0 },
  studentAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.crimsonSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  studentInitials: { color: COLORS.primary, fontSize: 13, fontWeight: '800' },
  studentName: { color: COLORS.ink, fontSize: 14, fontWeight: '700' },
  studentCode: { color: COLORS.muted, fontSize: 12, marginTop: 3 },
  importCard: {
    backgroundColor: COLORS.white,
    borderColor: '#ECECF0',
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    marginBottom: 18,
  },
  importCardHeading: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  importIcon: {
    width: 42,
    height: 42,
    borderRadius: 13,
    backgroundColor: COLORS.crimsonSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  importTitle: { color: COLORS.ink, fontSize: 15, fontWeight: '800' },
  loadingRoster: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 22,
  },
  loadingState: { alignItems: 'center', paddingVertical: 72 },
  loadingText: { color: COLORS.muted, fontSize: 13, marginTop: 10 },
  emptyState: {
    alignItems: 'center',
    backgroundColor: COLORS.white,
    borderColor: '#ECECF0',
    borderWidth: 1,
    borderRadius: 18,
    paddingHorizontal: 24,
    paddingVertical: 34,
    marginTop: 12,
  },
  emptyIcon: {
    width: 52,
    height: 52,
    borderRadius: 18,
    backgroundColor: COLORS.crimsonSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  emptyTitle: { color: COLORS.ink, fontSize: 16, fontWeight: '800' },
  emptyDescription: {
    color: COLORS.muted,
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    marginTop: 6,
  },
  searchEmpty: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    backgroundColor: COLORS.white,
    borderRadius: 14,
    padding: 18,
  },
  searchEmptyText: { color: COLORS.muted, fontSize: 13 },
  mutedText: { color: COLORS.muted, fontSize: 13, lineHeight: 19 },
  fileButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.crimsonSoft,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 44,
  },
  importButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.primary,
    borderRadius: 13,
    paddingHorizontal: 16,
    minHeight: 48,
    marginTop: 12,
  },
  disabledButton: { opacity: 0.48 },
  fileButtonText: { color: COLORS.primary, fontSize: 13, fontWeight: '700', marginLeft: 7 },
  importButtonText: { color: COLORS.white, fontSize: 14, fontWeight: '800' },
  fileChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: COLORS.greenBackground,
    borderRadius: 10,
    paddingHorizontal: 11,
    paddingVertical: 9,
    marginTop: 10,
  },
  fileName: { color: COLORS.green, fontSize: 12, flex: 1 },
  errorBox: {
    backgroundColor: COLORS.redBackground,
    borderRadius: 12,
    padding: 12,
    marginTop: 14,
  },
  errorText: { color: COLORS.red, fontSize: 13, lineHeight: 19 },
  messageBox: {
    backgroundColor: COLORS.greenBackground,
    borderRadius: 12,
    padding: 12,
    marginTop: 14,
  },
  messageText: { color: COLORS.green, fontSize: 13, lineHeight: 19 },
  rowErrors: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 12,
    marginTop: 8,
    gap: 4,
  },
})

export default EnrollmentImportScreen
