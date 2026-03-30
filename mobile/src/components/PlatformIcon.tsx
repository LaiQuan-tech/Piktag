import React from 'react';
import Svg, { Path, Rect, Circle, Defs, LinearGradient, Stop, G } from 'react-native-svg';
import { Globe, Link, Phone, Mail } from 'lucide-react-native';

type Props = {
  platform: string;
  size?: number;
};

export default function PlatformIcon({ platform, size = 24 }: Props) {
  const key = platform?.toLowerCase();

  if (key === 'instagram') {
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <Defs>
          <LinearGradient id="ig" x1="0" y1="1" x2="1" y2="0">
            <Stop offset="0" stopColor="#f09433" />
            <Stop offset="0.25" stopColor="#e6683c" />
            <Stop offset="0.5" stopColor="#dc2743" />
            <Stop offset="0.75" stopColor="#cc2366" />
            <Stop offset="1" stopColor="#bc1888" />
          </LinearGradient>
        </Defs>
        <Rect x="2" y="2" width="20" height="20" rx="6" fill="url(#ig)" />
        <Rect x="7" y="7" width="10" height="10" rx="3" stroke="white" strokeWidth="1.8" fill="none" />
        <Circle cx="12" cy="12" r="2.8" stroke="white" strokeWidth="1.8" fill="none" />
        <Circle cx="16.5" cy="7.5" r="1" fill="white" />
      </Svg>
    );
  }

  if (key === 'facebook') {
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <Rect x="2" y="2" width="20" height="20" rx="6" fill="#1877F2" />
        <Path
          d="M13.5 8H15V5.5H13C11.3 5.5 10 6.8 10 8.5V10H8V12.5H10V18.5H12.5V12.5H14.5L15 10H12.5V8.5C12.5 8.2 12.7 8 13 8H13.5Z"
          fill="white"
        />
      </Svg>
    );
  }

  if (key === 'linkedin') {
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <Rect x="2" y="2" width="20" height="20" rx="6" fill="#0A66C2" />
        <Path d="M7 10H9.5V17H7V10Z" fill="white" />
        <Circle cx="8.25" cy="7.5" r="1.25" fill="white" />
        <Path d="M11 10H13.5V11.2C13.9 10.5 14.8 10 16 10C17.7 10 19 11.1 19 13.2V17H16.5V13.8C16.5 12.8 16 12.2 15 12.2C14 12.2 13.5 12.9 13.5 13.8V17H11V10Z" fill="white" />
      </Svg>
    );
  }

  if (key === 'line') {
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <Rect x="2" y="2" width="20" height="20" rx="6" fill="#00C300" />
        <Path
          d="M12 5.5C8.4 5.5 5.5 7.9 5.5 10.8C5.5 13.4 7.8 15.6 10.9 16.1L11.4 16.9C11.6 17.2 12 17.1 12 16.8V15.8C15.1 15.3 18.5 13.3 18.5 10.8C18.5 7.9 15.6 5.5 12 5.5Z"
          fill="white"
        />
        <Path d="M9 11.5H8V9.5H9V11.5Z" fill="#00C300" />
        <Path d="M11 11.5H10V9.5H11V11.5Z" fill="#00C300" />
        <Path d="M13.5 11.5H12.5V9.5H13.5V11.5Z" fill="#00C300" />
        <Path d="M16 11.5H15V9.5H16V11.5Z" fill="#00C300" />
      </Svg>
    );
  }

  if (key === 'phone' || key === '電話') {
    return <Phone size={size} color="#059669" />;
  }

  if (key === 'email' || key === 'mail') {
    return <Mail size={size} color="#2563EB" />;
  }

  if (key === 'website' || key === '個人網站') {
    return <Globe size={size} color="#6B7280" />;
  }

  return <Link size={size} color="#6B7280" />;
}
