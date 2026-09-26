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
// DESIGN TOKENS
// ============================================================

const T = {
  crimson: '#8B0000',
  crimsonLight: '#A61B1B',
  ink: '#0B0B0D',
  inkSoft: '#3F3F46',
  inkMuted: '#71717A',
  inkFaint: '#A1A1AA',
  hair: '#E7E7E9',
  hair2: '#F1F1F3',
  canvas: '#F2F2F4',
  surface: '#FFFFFF',
  green: '#0F7A4A',
  greenSoft: '#ECFDF5',
  amber: '#B45309',
  amberSoft: '#FEF3C7',
  red: '#9F1239',
  redSoft: '#FCE7F3',
  blue: '#1D4ED8',
  blueSoft: '#DBEAFE',
  slate: '#94A3B8',
  slateSoft: '#F1F5F9',
}

// ============================================================
// CONSTANTS
// ============================================================

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

// Short label for the position (keeps card titles compact)
const ROLE_TAG = (position = '') => {
  const p = position.toLowerCase()
  if (p.includes('president') && !p.includes('vice')) return 'PRESIDENT'
  if (p.includes('vice president') || p.startsWith('vp ')) return 'VICE PRES'
  if (p.includes('chancellor')) return 'CHANCELLOR'
  if (p.includes('dean')) return 'DEAN'
  if (p.includes('director')) return 'DIRECTOR'
  if (p.includes('chair') || p.includes('head')) return 'CHAIR'
  if (p.includes('coordinator')) return 'COORD'
  return 'OFFICIAL'
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
        <ActivityIndicator size="large" color={T.crimson} />
        <Text style={styles.loadingText}>Loading officials…</Text>
      </View>
    )
  }

  // ------------------------------------------------------------
  // RENDER
  // ------------------------------------------------------------
  return (
    <View style={styles.container}>
      {/* ==================== RED HEADER ==================== */}
      <View style={styles.header}>
        <View style={styles.headerDecor1} />
        <View style={styles.headerDecor2} />

        <View style={styles.headerContent}>
          <View style={styles.headerTopRow}>
            <TouchableOpacity
              onPress={() => navigation.goBack()}
              style={styles.headerBack}
              activeOpacity={0.75}
              hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
            >
              <Text style={styles.headerBackText}>‹</Text>
            </TouchableOpacity>

            <View style={{ flex: 1, paddingLeft: 12 }}>
              <Text style={styles.headerEyebrow}>UNIVERSITY DIRECTORY</Text>
              <Text style={styles.headerTitle}>Officials</Text>
            </View>

            <View style={styles.headerCountPill}>
              <Text style={styles.headerCountText}>
                {String(officials.length).padStart(2, '0')}
              </Text>
            </View>
          </View>
        </View>
      </View>

      {/* ==================== SEARCH ==================== */}
      <View style={styles.searchWrap}>
        <View style={styles.searchBox}>
          <Feather name="search" size={15} color={T.inkFaint} />
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search name, position, or college…"
            placeholderTextColor={T.inkFaint}
            style={styles.searchInput}
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
            onSubmitEditing={() => Keyboard.dismiss()}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity
              onPress={() => setSearchQuery('')}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Feather name="x" size={16} color={T.inkFaint} />
            </TouchableOpacity>
          )}
        </View>

        <Text style={styles.resultCount}>
          {totalCount} {totalCount === 1 ? 'OFFICIAL' : 'OFFICIALS'}
          {searchQuery.trim() ? ' FOUND' : ''}
        </Text>
      </View>

      {/* ==================== ERROR ==================== */}
      {errorMessage ? (
        <View style={styles.errorBox}>
          <View style={styles.errorStripe} />
          <Feather name="alert-circle" size={15} color={T.red} />
          <Text style={styles.errorText} numberOfLines={3}>
            {errorMessage}
          </Text>
        </View>
      ) : null}

      {/* ==================== EMPTY ==================== */}
      {!errorMessage && sections.length === 0 ? (
        <View style={styles.emptyWrap}>
          <View style={styles.emptyIconWrap}>
            <View style={styles.emptyIconRing} />
            <View style={styles.emptyIconDot} />
          </View>
          <Text style={styles.emptyEyebrow}>
            {searchQuery.trim() ? 'NO MATCHES' : 'DIRECTORY EMPTY'}
          </Text>
          <Text style={styles.emptyTitle}>
            {searchQuery.trim() ? 'Nothing found' : 'No officials yet'}
          </Text>
          <Text style={styles.emptyText}>
            {searchQuery.trim()
              ? `Nothing matched "${searchQuery}". Try another name, position, or college.`
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
              tintColor={T.crimson}
            />
          }
          renderSectionHeader={({ section }) => (
            <View style={styles.sectionHeader}>
              <View style={styles.sectionDot} />
              <Text style={styles.sectionTitle} numberOfLines={1}>
                {section.title}
              </Text>
              <View style={styles.sectionCountPill}>
                <Text style={styles.sectionCountText}>
                  {String(section.data.length).padStart(2, '0')}
                </Text>
              </View>
            </View>
          )}
          renderItem={({ item }) => {
            const expanded = expandedId === item.id
            const initial = (item.full_name || '?')
              .trim()
              .charAt(0)
              .toUpperCase()
            const roleTag = ROLE_TAG(item.position || '')

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

                    <View style={styles.metaLineRow}>
                      <View style={styles.roleTag}>
                        <Text style={styles.roleTagText}>{roleTag}</Text>
                      </View>
                      {item.college ? (
                        <Text
                          style={styles.metaLine}
                          numberOfLines={1}
                        >
                          {item.college}
                        </Text>
                      ) : null}
                    </View>

                    <Text
                      style={styles.position}
                      numberOfLines={2}
                    >
                      {item.position}
                    </Text>
                  </View>

                  <Feather
                    name={expanded ? 'chevron-up' : 'chevron-down'}
                    size={18}
                    color={T.inkFaint}
                  />
                </View>

                {expanded && (
                  <View style={styles.details}>
                    {item.office_location ? (
                      <View style={styles.detailRow}>
                        <View style={styles.detailIcon}>
                          <Feather
                            name="map-pin"
                            size={13}
                            color={T.crimson}
                          />
                        </View>
                        <Text style={styles.detailText} numberOfLines={2}>
                          {item.office_location}
                        </Text>
                      </View>
                    ) : null}

                    {item.contact_email ? (
                      <View style={styles.detailRow}>
                        <View style={styles.detailIcon}>
                          <Feather name="mail" size={13} color={T.crimson} />
                        </View>
                        <Text style={styles.detailText} numberOfLines={1}>
                          {item.contact_email}
                        </Text>
                      </View>
                    ) : null}

                    {item.contact_number ? (
                      <View style={styles.detailRow}>
                        <View style={styles.detailIcon}>
                          <Feather name="phone" size={13} color={T.crimson} />
                        </View>
                        <Text style={styles.detailText} numberOfLines={1}>
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
                          <Feather name="mail" size={13} color="#FFFFFF" />
                          <Text style={styles.actionButtonText}>Email</Text>
                        </TouchableOpacity>
                      ) : null}

                      {item.contact_number ? (
                        <TouchableOpacity
                          style={[styles.actionButton, styles.actionButtonAlt]}
                          onPress={() => handleCall(item.contact_number)}
                          activeOpacity={0.85}
                        >
                          <Feather name="phone" size={13} color={T.crimson} />
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
  container: { flex: 1, backgroundColor: T.canvas },

  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: T.canvas,
  },
  loadingText: {
    marginTop: 12,
    color: T.inkMuted,
    fontSize: 13,
    fontWeight: '500',
  },

  // ==================== HEADER ====================
  header: {
    backgroundColor: T.crimson,
    paddingTop: 54,
    paddingBottom: 22,
    overflow: 'hidden',
  },
  headerDecor1: {
    position: 'absolute',
    top: -60,
    right: -40,
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: T.crimsonLight,
    opacity: 0.4,
  },
  headerDecor2: {
    position: 'absolute',
    top: 30,
    right: 30,
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#FFFFFF',
    opacity: 0.06,
  },
  headerContent: {
    paddingHorizontal: 20,
  },
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerBack: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.28)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerBackText: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '600',
    lineHeight: 22,
    marginTop: -4,
  },
  headerEyebrow: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 2,
    color: '#FFFFFF',
    opacity: 0.65,
    marginBottom: 4,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: -0.3,
  },
  headerCountPill: {
    minWidth: 40,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.24)',
    alignItems: 'center',
  },
  headerCountText: {
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.2,
    color: '#FFFFFF',
    fontVariant: ['tabular-nums'],
  },

  // ==================== SEARCH ====================
  searchWrap: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
    backgroundColor: T.canvas,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: T.surface,
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 44,
    gap: 8,
    borderWidth: 1,
    borderColor: T.hair,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: T.ink,
    padding: 0,
    fontWeight: '500',
  },
  resultCount: {
    fontSize: 9,
    color: T.inkFaint,
    fontWeight: '900',
    letterSpacing: 1.4,
    marginTop: 10,
    marginLeft: 4,
  },

  // ==================== ERROR ====================
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginTop: 8,
    paddingVertical: 12,
    paddingRight: 12,
    backgroundColor: T.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: T.hair,
    overflow: 'hidden',
  },
  errorStripe: {
    width: 4,
    alignSelf: 'stretch',
    backgroundColor: T.red,
    marginRight: 8,
  },
  errorText: {
    color: T.red,
    fontSize: 12,
    flex: 1,
    fontWeight: '600',
  },

  // ==================== EMPTY ====================
  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
  },
  emptyIconWrap: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: T.surface,
    borderWidth: 1,
    borderColor: T.hair,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 22,
  },
  emptyIconRing: {
    position: 'absolute',
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: T.crimson,
    opacity: 0.35,
  },
  emptyIconDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: T.crimson,
  },
  emptyEyebrow: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 2,
    color: T.crimson,
    marginBottom: 8,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '900',
    color: T.ink,
    letterSpacing: -0.3,
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 13,
    color: T.inkMuted,
    textAlign: 'center',
    lineHeight: 19,
    fontWeight: '500',
    paddingHorizontal: 12,
  },

  // ==================== LIST ====================
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 40,
  },

  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 22,
    marginBottom: 12,
    gap: 10,
  },
  sectionDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: T.crimson,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '900',
    color: T.ink,
    flex: 1,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  sectionCountPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: T.hair2,
  },
  sectionCountText: {
    fontSize: 10,
    fontWeight: '900',
    color: T.inkMuted,
    letterSpacing: 0.6,
    fontVariant: ['tabular-nums'],
  },

  // ==================== CARD ====================
  card: {
    backgroundColor: T.surface,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: T.hair,
  },
  cardExpanded: {
    borderColor: '#F3C6C6',
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
    borderWidth: 1,
    borderColor: '#F5C2C0',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  avatarText: {
    fontSize: 16,
    fontWeight: '900',
    color: T.crimson,
    letterSpacing: 0.4,
  },
  cardInfo: {
    flex: 1,
    marginRight: 8,
  },
  name: {
    fontSize: 15,
    fontWeight: '900',
    color: T.ink,
    letterSpacing: -0.3,
  },

  metaLineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 5,
    flexWrap: 'wrap',
  },
  roleTag: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: T.crimson,
  },
  roleTagText: {
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 1,
    color: '#FFFFFF',
  },
  metaLine: {
    fontSize: 10,
    fontWeight: '800',
    color: T.inkFaint,
    letterSpacing: 0.8,
    flexShrink: 1,
  },

  position: {
    fontSize: 12,
    color: T.inkSoft,
    marginTop: 5,
    fontWeight: '600',
    lineHeight: 17,
  },

  // ==================== DETAILS ====================
  details: {
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: T.hair2,
    gap: 12,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  detailIcon: {
    width: 26,
    height: 26,
    borderRadius: 8,
    backgroundColor: '#FDECEC',
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailText: {
    fontSize: 12,
    color: T.inkSoft,
    flex: 1,
    fontWeight: '600',
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
    backgroundColor: T.crimson,
    paddingVertical: 11,
    borderRadius: 10,
  },
  actionButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0.4,
  },
  actionButtonAlt: {
    backgroundColor: T.surface,
    borderWidth: 1.5,
    borderColor: T.crimson,
  },
  actionButtonTextAlt: {
    color: T.crimson,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0.4,
  },
})

export default OfficialsScreen