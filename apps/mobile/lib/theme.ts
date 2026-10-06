import { DarkTheme, type Theme } from 'expo-router/react-navigation';

// React Navigation needs concrete colors; these mirror the tokens in global.css.
export const COLORS = {
  night: '#1C1D45',
  raised: '#2A2C66',
  ticket: '#FFD84A',
  ink: '#17162E',
  bulb: '#FF5A4E',
  paper: '#F4F3FF',
};

export const NAV_THEME: Theme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: COLORS.night,
    card: COLORS.night,
    text: COLORS.paper,
    border: '#3A3D80',
    primary: COLORS.ticket,
    notification: COLORS.bulb,
  },
};
