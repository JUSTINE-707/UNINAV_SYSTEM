import { useEffect, useState, useMemo, useCallback } from 'react'
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  SectionList,
  RefreshControl,
  Linking,
  Alert,
  Keyboard,
} from 'react-native'
import { useNavigation } from '@react-navigation/native'
import { Feather } from '@expo/vector-icons'

import { supabase } from '../../services/supabase'

// ============================================================
// CONSTANTS
// ============================================================

const PRIMARY = '#8B0000'
const BG = '#F5F5F7'

// Heuristic rank from position title, so the most senior
// officials appear at the top of each college group.
const rankOf = (position = '') => {
  const p = position.toLowerCase()
  if (p.includes('president') && !p.includes('vice')) return 1
  if (p.includes('vice president') || p.startsWith('vp ')) return 2
  if (p.includes('chancellor')) return 3
  if (p.includes('dean')) return 4
  if (p.includes('director')) return 5
  if (p.includes('chair') || p.includes('head')) return 6
  if (p.includes('coordinator')) return 7
  return 8
}

// ============================================================
// SCREEN
// ============================================================

const OfficialsScreen = () => {
  const navigation = useNavigation()

  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [errorMessage, setErrorMessage] = useState(null)
  const [officials, setOfficials] = useState([])
  const [searchQuery, setSearchQuery] = useState('')
  const [expandedId, setExpandedId] = useState(null)

  // ------------------------------------------------------------
  // LOAD
  // ------------------------------------------------------------
  const loadOfficials = useCallback(async () => {
    try {
      setErrorMessage(null)

      const { data, error } = await supabase
        .from('officials')
        .select(
          'id, full_name, position, college, office_location, contact_email, contact_number'
        )
        .order('full_name', { ascending: true })

      if (error) {
        setErrorMessage(error.message)
        return
      }

      setOfficials(data || [])
    } catch (err) {
      setErrorMessage(err.message || 'Failed to load officials.')
    }
  }, [])

  useEffect(() => {
    const run = async () => {
      setLoading(true)
      await loadOfficials()
      setLoading(false)
    }
    run()
  }, [loadOfficials])

  const handleRefresh = async () => {
    setRefreshing(true)
    await loadOfficials()
    setRefreshing(false)
  }

  // ------------------------------------------------------------
  // SEARCH + GROUPING
  // ------------------------------------------------------------
  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return officials
    const q = searchQuery.trim().toLowerCase()

    return officials.filter((o) => {
      const hay = [
        o.full_name,
        o.position,
        o.college,
        o.office_location,
        o.contact_email,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return hay.includes(q)
    })
  }, [officials, searchQuery])

  const sections = useMemo(() => {
    const groups = {}

    filtered.forEach((o) => {
      const key = o.college?.trim() ? o.college.trim() : 'University Administration'
      if (!groups[key]) groups[key] = []
      groups[key].push(o)
    })

    return Object.entries(groups)
      .map(([title, list]) => ({
        title,
        data: [...list].sort((a, b) => {
          const ra = rankOf(a.position)
          const rb = rankOf(b.position)
          if (ra !== rb) return ra - rb
          return (a.full_name || '').localeCompare(b.full_name || '')
        }),
      }))
      .sort((a, b) => {
        // Put University Administration first, then alphabetical
        if (a.title === 'University Administration') return -1
        if (b.title === 'University Administration') return 1
        return a.title.localeCompare(b.title)
      })
  }, [filtered])

  const totalCount = filtered.length

  // ------------------------------------------------------------
  // ACTIONS
  // ------------------------------------------------------------
  const handleEmail = (email) => {
    if (!email) return
    Linking.openURL(`mailto:${email}`).catch(() =>
      Alert.alert('Cannot open email', `Email: ${email}`)
    )
  }

  const handleCall = (number) => {
    if (!number) return
    const cleaned = number.replace(/[^\d+]/g, '')
    Linking.openURL(`tel:${cleaned}`).catch(() =>
      Alert.alert('Cannot open dialer', `Number: ${number}`)
    )
  }

  const toggleExpand = (id) => {
    setExpandedId((prev) => (prev === id ? null : id))
  }

  // ------------------------------------------------------------
  // LOADING
  // ------------------------------------------------------------
  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={PRIMARY} />
        <Text style={styles.loadingText}>Loading officials…</Text>
      </View>
    )
  }

  // ------------------------------------------------------------
  // RENDER
  // ------------------------------------------------------------
  return (
    <View style={styles.container}>
      {/* HEADER */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.headerBack}
        >
          <Feather name="chevron-left" size={24} color="#FFFFFF" />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerEyebrow}>UNIVERSITY DIRECTORY</Text>
          <Text style={styles.headerTitle}>Officials</Text>
        </View>
        <View style={styles.headerBack} />
      </View>

      {/* SEARCH */}
      <View style={styles.searchWrap}>
        <View style={styles.searchBox}>
          <Feather name="search" size={16} color="#9CA3AF" />
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search name, position, or college…"
            placeholderTextColor="#9CA3AF"
            style={styles.searchInput}
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
            onSubmitEditing={() => Keyboard.dismiss()}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <Feather name="x" size={18} color="#9CA3AF" />
            </TouchableOpacity>
          )}
        </View>
        <Text style={styles.resultCount}>
          {totalCount} {totalCount === 1 ? 'official' : 'officials'}
        </Text>
      </View>

      {/* ERROR */}
      {errorMessage ? (
        <View style={styles.errorBox}>
          <Feather name="alert-circle" size={16} color="#B00020" />
          <Text style={styles.errorText}>{errorMessage}</Text>
        </View>
      ) : null}

      {/* EMPTY */}
      {!errorMessage && sections.length === 0 ? (
        <View style={styles.emptyWrap}>
          <View style={styles.emptyIconWrap}>
            <Feather name="users" size={32} color={PRIMARY} />
          </View>
          <Text style={styles.emptyTitle}>
            {searchQuery.trim() ? 'No matches' : 'No officials yet'}
          </Text>
          <Text style={styles.emptyText}>
            {searchQuery.trim()
              ? `Nothing matched "${searchQuery}".`
              : 'The directory has not been populated yet.'}
          </Text>
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          stickySectionHeadersEnabled={false}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={PRIMARY}
            />
          }
          renderSectionHeader={({ section }) => (
            <View style={styles.sectionHeader}>
              <View style={styles.sectionDot} />
              <Text style={styles.sectionTitle}>{section.title}</Text>
              <Text style={styles.sectionCount}>{section.data.length}</Text>
            </View>
          )}
          renderItem={({ item }) => {
            const expanded = expandedId === item.id
            const initial = (item.full_name || '?')
              .trim()
              .charAt(0)
              .toUpperCase()

            return (
              <TouchableOpacity
                style={[styles.card, expanded && styles.cardExpanded]}
                activeOpacity={0.85}
                onPress={() => toggleExpand(item.id)}
              >
                <View style={styles.cardTop}>
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>{initial}</Text>
                  </View>

                  <View style={styles.cardInfo}>
                    <Text style={styles.name} numberOfLines={2}>
                      {item.full_name}
                    </Text>
                    <Text style={styles.position} numberOfLines={2}>
                      {item.position}
                    </Text>
                    {item.college ? (
                      <View style={styles.collegePill}>
                        <Text style={styles.collegePillText} numberOfLines={1}>
                          {item.college}
                        </Text>
                      </View>
                    ) : null}
                  </View>

                  <Feather
                    name={expanded ? 'chevron-up' : 'chevron-down'}
                    size={20}
                    color="#9CA3AF"
                  />
                </View>

                {expanded && (
                  <View style={styles.details}>
                    {item.office_location ? (
                      <View style={styles.detailRow}>
                        <Feather name="map-pin" size={14} color={PRIMARY} />
                        <Text style={styles.detailText}>
                          {item.office_location}
                        </Text>
                      </View>
                    ) : null}

                    {item.contact_email ? (
                      <View style={styles.detailRow}>
                        <Feather name="mail" size={14} color={PRIMARY} />
                        <Text style={styles.detailText} numberOfLines={1}>
                          {item.contact_email}
                        </Text>
                      </View>
                    ) : null}

                    {item.contact_number ? (
                      <View style={styles.detailRow}>
                        <Feather name="phone" size={14} color={PRIMARY} />
                        <Text style={styles.detailText}>
                          {item.contact_number}
                        </Text>
                      </View>
                    ) : null}

                    <View style={styles.actionRow}>
                      {item.contact_email ? (
                        <TouchableOpacity
                          style={styles.actionButton}
                          onPress={() => handleEmail(item.contact_email)}
                          activeOpacity={0.85}
                        >
                          <Feather name="mail" size={14} color="#FFFFFF" />
                          <Text style={styles.actionButtonText}>Email</Text>
                        </TouchableOpacity>
                      ) : null}

                      {item.contact_number ? (
                        <TouchableOpacity
                          style={[styles.actionButton, styles.actionButtonAlt]}
                          onPress={() => handleCall(item.contact_number)}
                          activeOpacity={0.85}
                        >
                          <Feather name="phone" size={14} color={PRIMARY} />
                          <Text style={styles.actionButtonTextAlt}>Call</Text>
                        </TouchableOpacity>
                      ) : null}
                    </View>
                  </View>
                )}
              </TouchableOpacity>
            )
          }}
        />
      )}
    </View>
  )
}

// ============================================================
// STYLES
// ============================================================

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },

  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: BG,
  },
  loadingText: { marginTop: 12, color: '#6B7280', fontSize: 14 },

  // HEADER
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingTop: 54,
    paddingBottom: 16,
    backgroundColor: PRIMARY,
  },
  headerBack: { width: 40, alignItems: 'center' },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerEyebrow: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.2,
    color: '#FFD5D5',
    marginBottom: 2,
  },
  headerTitle: { fontSize: 20, fontWeight: '800', color: '#FFFFFF' },

  // SEARCH
  searchWrap: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 8,
    backgroundColor: BG,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 44,
    gap: 8,
    borderWidth: 1,
    borderColor: '#ECECEC',
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: '#1A1A1A',
    padding: 0,
  },
  resultCount: {
    fontSize: 12,
    color: '#9CA3AF',
    fontWeight: '600',
    marginTop: 8,
    marginLeft: 2,
  },

  // ERROR
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginTop: 8,
    padding: 12,
    backgroundColor: '#FDECEC',
    borderRadius: 10,
    borderLeftWidth: 4,
    borderLeftColor: '#B00020',
  },
  errorText: { color: '#B00020', fontSize: 13, flex: 1 },

  // EMPTY
  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
  },
  emptyIconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#FDECEC',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#1A1A1A',
    marginBottom: 6,
  },
  emptyText: {
    fontSize: 13,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 20,
  },

  // LIST
  listContent: { padding: 16, paddingBottom: 40 },

  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 18,
    marginBottom: 10,
  },
  sectionDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: PRIMARY,
    marginRight: 10,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#1A1A1A',
    flex: 1,
  },
  sectionCount: {
    fontSize: 12,
    fontWeight: '700',
    color: '#9CA3AF',
  },

  // CARD
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#ECECEC',
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  cardExpanded: {
    borderColor: '#F3C6C6',
    shadowColor: PRIMARY,
    shadowOpacity: 0.10,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#FDECEC',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  avatarText: {
    fontSize: 18,
    fontWeight: '800',
    color: PRIMARY,
  },
  cardInfo: { flex: 1, marginRight: 8 },
  name: {
    fontSize: 15,
    fontWeight: '800',
    color: '#1A1A1A',
    letterSpacing: -0.2,
  },
  position: {
    fontSize: 12,
    color: '#4B5563',
    marginTop: 2,
    fontWeight: '500',
  },
  collegePill: {
    alignSelf: 'flex-start',
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    marginTop: 6,
  },
  collegePillText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#6B7280',
    letterSpacing: 0.3,
  },

  // DETAILS
  details: {
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
    gap: 10,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  detailText: {
    fontSize: 13,
    color: '#4B5563',
    flex: 1,
    fontWeight: '500',
  },

  actionRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 6,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: PRIMARY,
    paddingVertical: 10,
    borderRadius: 10,
  },
  actionButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  actionButtonAlt: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: PRIMARY,
  },
  actionButtonTextAlt: {
    color: PRIMARY,
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
})

export default OfficialsScreen