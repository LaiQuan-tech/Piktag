import React, { useEffect, useState } from 'react';
import { ActivityIndicator, View, StyleSheet } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import {
  Home,
  Search,
  QrCode,
  Bell,
  User,
} from 'lucide-react-native';
import { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { COLORS } from '../constants/theme';

// Auth Screens
import LoginScreen from '../screens/auth/LoginScreen';
import RegisterScreen from '../screens/auth/RegisterScreen';
import OnboardingScreen from '../screens/auth/OnboardingScreen';
import PhoneAuthScreen from '../screens/auth/PhoneAuthScreen';

// Main Screens
import ConnectionsScreen from '../screens/ConnectionsScreen';
import SearchScreen from '../screens/SearchScreen';
import AddTagScreen from '../screens/AddTagScreen';
import ProfileScreen from '../screens/ProfileScreen';
import EditProfileScreen from '../screens/EditProfileScreen';
import UserDetailScreen from '../screens/UserDetailScreen';
import FriendDetailScreen from '../screens/FriendDetailScreen';
import SettingsScreen from '../screens/SettingsScreen';
import ContactSyncScreen from '../screens/ContactSyncScreen';
import InviteScreen from '../screens/InviteScreen';
import LocationContactsScreen from '../screens/LocationContactsScreen';
import SocialStatsScreen from '../screens/SocialStatsScreen';
import NotificationsScreen from '../screens/NotificationsScreen';
import ScanResultScreen from '../screens/ScanResultScreen';
import CameraScanScreen from '../screens/CameraScanScreen';
import TagDetailScreen from '../screens/TagDetailScreen';
import ManageTagsScreen from '../screens/ManageTagsScreen';

// Stack Navigators
const AuthStack = createNativeStackNavigator();
const HomeStack = createNativeStackNavigator();
const SearchStack = createNativeStackNavigator();
const AddTagStack = createNativeStackNavigator();
const NotificationStack = createNativeStackNavigator();
const ProfileStack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

function AuthNavigator() {
  return (
    <AuthStack.Navigator screenOptions={{ headerShown: false }}>
      <AuthStack.Screen name="Login" component={LoginScreen} />
      <AuthStack.Screen name="Register" component={RegisterScreen} />
      <AuthStack.Screen name="PhoneAuth" component={PhoneAuthScreen} />
    </AuthStack.Navigator>
  );
}

function HomeStackNavigator() {
  return (
    <HomeStack.Navigator screenOptions={{ headerShown: false }}>
      <HomeStack.Screen name="Connections" component={ConnectionsScreen} />
      <HomeStack.Screen name="FriendDetail" component={FriendDetailScreen} />
      <HomeStack.Screen name="UserDetail" component={UserDetailScreen} />
      <HomeStack.Screen name="TagDetail" component={TagDetailScreen} />
    </HomeStack.Navigator>
  );
}

function SearchStackNavigator() {
  return (
    <SearchStack.Navigator screenOptions={{ headerShown: false }}>
      <SearchStack.Screen name="SearchMain" component={SearchScreen} />
      <SearchStack.Screen name="UserDetail" component={UserDetailScreen} />
      <SearchStack.Screen name="TagDetail" component={TagDetailScreen} />
      <SearchStack.Screen name="FriendDetail" component={FriendDetailScreen} />
    </SearchStack.Navigator>
  );
}

function AddTagStackNavigator() {
  return (
    <AddTagStack.Navigator screenOptions={{ headerShown: false }}>
      <AddTagStack.Screen name="AddTagMain" component={AddTagScreen} />
      <AddTagStack.Screen name="CameraScan" component={CameraScanScreen} />
    </AddTagStack.Navigator>
  );
}

function NotificationStackNavigator() {
  return (
    <NotificationStack.Navigator screenOptions={{ headerShown: false }}>
      <NotificationStack.Screen name="NotificationMain" component={NotificationsScreen} />
    </NotificationStack.Navigator>
  );
}

function ProfileStackNavigator() {
  return (
    <ProfileStack.Navigator screenOptions={{ headerShown: false }}>
      <ProfileStack.Screen name="ProfileMain" component={ProfileScreen} />
      <ProfileStack.Screen name="EditProfile" component={EditProfileScreen} />
      <ProfileStack.Screen name="ManageTags" component={ManageTagsScreen} />
      <ProfileStack.Screen name="Settings" component={SettingsScreen} />
      <ProfileStack.Screen name="ContactSync" component={ContactSyncScreen} />
      <ProfileStack.Screen name="Invite" component={InviteScreen} />
      <ProfileStack.Screen name="LocationContacts" component={LocationContactsScreen} />
      <ProfileStack.Screen name="SocialStats" component={SocialStatsScreen} />
      <ProfileStack.Screen name="TagDetail" component={TagDetailScreen} />
      <ProfileStack.Screen name="UserDetail" component={UserDetailScreen} />
    </ProfileStack.Navigator>
  );
}

function MainTabs() {
  return (
    <Tab.Navigator
      detachInactiveScreens={true}
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: false,
        tabBarStyle: {
          backgroundColor: COLORS.white,
          borderTopWidth: 1,
          borderTopColor: COLORS.gray100,
          paddingBottom: 28,
          paddingTop: 10,
          height: 80,
        },
        tabBarActiveTintColor: COLORS.piktag500,
        tabBarInactiveTintColor: COLORS.gray400,
      }}
    >
      <Tab.Screen
        name="HomeTab"
        component={HomeStackNavigator}
        options={{
          tabBarIcon: ({ color, focused }) => (
            <Home
              size={24}
              color={color}
              strokeWidth={focused ? 2.5 : 2}
            />
          ),
        }}
      />
      <Tab.Screen
        name="SearchTab"
        component={SearchStackNavigator}
        options={{
          tabBarIcon: ({ color, focused }) => (
            <Search
              size={24}
              color={color}
              strokeWidth={focused ? 2.5 : 2}
            />
          ),
        }}
      />
      <Tab.Screen
        name="AddTagTab"
        component={AddTagStackNavigator}
        options={{
          tabBarIcon: ({ color, focused }) => (
            <QrCode
              size={28}
              color={color}
              strokeWidth={focused ? 2.5 : 2}
            />
          ),
        }}
      />
      <Tab.Screen
        name="NotificationsTab"
        component={NotificationStackNavigator}
        options={{
          tabBarIcon: ({ color, focused }) => (
            <Bell
              size={24}
              color={color}
              strokeWidth={focused ? 2.5 : 2}
            />
          ),
        }}
      />
      <Tab.Screen
        name="ProfileTab"
        component={ProfileStackNavigator}
        options={{
          tabBarIcon: ({ color, focused }) => (
            <User
              size={24}
              color={color}
              strokeWidth={focused ? 2.5 : 2}
            />
          ),
        }}
      />
    </Tab.Navigator>
  );
}

// Root stack that wraps MainTabs + modal screens + onboarding
const RootStack = createNativeStackNavigator();

function MainNavigator({ needsOnboarding }: { needsOnboarding: boolean }) {
  return (
    <RootStack.Navigator screenOptions={{ headerShown: false }}>
      {needsOnboarding ? (
        <RootStack.Screen name="Onboarding" component={OnboardingScreen} />
      ) : null}
      <RootStack.Screen name="Main" component={MainTabs} />
      {/* AddTagModal removed — # is now a regular tab, not a modal */}
      <RootStack.Screen
        name="ScanResult"
        component={ScanResultScreen}
        options={{ presentation: 'modal' }}
      />
    </RootStack.Navigator>
  );
}

export default function AppNavigator() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session: currentSession } }) => {
      setSession(currentSession);
      if (currentSession?.user) {
        checkOnboardingStatus(currentSession.user.id, currentSession.user.created_at);
      } else {
        setLoading(false);
      }
    });

    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, newSession) => {
        setSession(newSession);
        if (newSession?.user) {
          checkOnboardingStatus(newSession.user.id, newSession.user.created_at);
        } else {
          setNeedsOnboarding(false);
          setLoading(false);
        }
      }
    );

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const checkOnboardingStatus = async (userId: string, userCreatedAt: string) => {
    try {
      // Check if user account was created within the last 5 minutes
      const createdAt = new Date(userCreatedAt);
      const now = new Date();
      const diffMs = now.getTime() - createdAt.getTime();
      const isNewUser = diffMs < 5 * 60 * 1000; // 5 minutes

      if (!isNewUser) {
        setNeedsOnboarding(false);
        setLoading(false);
        return;
      }

      // Check if bio is filled in (onboarding complete indicator)
      const { data, error } = await supabase
        .from('piktag_profiles')
        .select('bio')
        .eq('id', userId)
        .single();

      if (error) {
        console.warn('Error checking onboarding status:', error.message);
        setNeedsOnboarding(false);
      } else {
        const bioEmpty = !data?.bio || data.bio.trim() === '';
        setNeedsOnboarding(bioEmpty);
      }
    } catch (err) {
      console.warn('Onboarding check error:', err);
      setNeedsOnboarding(false);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={COLORS.piktag500} />
      </View>
    );
  }

  return session ? (
    <MainNavigator needsOnboarding={needsOnboarding} />
  ) : (
    <AuthNavigator />
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.white,
  },
});
