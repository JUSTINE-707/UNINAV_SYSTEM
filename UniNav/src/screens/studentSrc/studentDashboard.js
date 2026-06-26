import {View, Text, StyleSheet, TouchableOpacity} from 'react-native';
import {COLORS, FONTS, SIZES} from '../../constants/theme';

const StudentDashboard = ({navigation}) => {
  return (
    <View style={styles.container}>
        <Text style={styles.title}>Student Dashboard</Text>
        <TouchableOpacity
          style={styles.logoutButton}
          onPress={() => navigation.navigate('Login')}
        >
          <Text style={styles.logoutText}>Logout</Text>
        </TouchableOpacity>
      </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
    justifyContent: 'center',
    alignItems: 'center',
    },
    title: {
    fontSize: FONTS.large,
    fontWeight: 'bold',
    color: COLORS.primary,
    },
    logoutButton: {
      marginTop: 20,
      paddingVertical: 10,
      paddingHorizontal: 20,
      backgroundColor: COLORS.danger,
      borderRadius: 5,
    },
    logoutText: {
      color: COLORS.black,
      fontSize: FONTS.medium,
      fontWeight: 'bold',
    }
});

export default StudentDashboard;